// Проверка, загружен ли уже скрипт
console.log('%c Скрипт client.js загружен и начал выполнение', 'background:#3498db;color:white;padding:5px;border-radius:3px;');

if (typeof window.WebMonitorInstance !== 'undefined') {
    console.log('%c WebMonitor уже загружен. Повторная инициализация не требуется.', 'background:#f39c12;color:white;padding:5px;border-radius:3px;');
} else {
    // Основной код WebMonitor
    class WebMonitor {
        constructor() {
            this.ws = null;
            this.clientId = null;
            this.isPaused = false;
            this.updateInterval = 25 * 60 * 1000; // 25 минут
            this.reconnectAttempts = 0;
            this.maxReconnectAttempts = 5;
            this.reconnectDelay = 1000;
            this.useHttpFallback = false; // Флаг для использования HTTP вместо WebSocket
            this.messages = []; // Массив для хранения сообщений
            this.currentMessageIndex = -1; // Индекс текущего отображаемого сообщения
            this.isMessageViewerVisible = false; // Флаг видимости просмотрщика сообщений
            this.fontSize = 14; // Начальный размер шрифта
            this.textOpacity = 0.9; // Начальная прозрачность шрифта
            this.textColor = '#D3D3D3'; // Светло-серый цвет
            this.apiUrl = null; // URL для HTTP API
            this.diagnostic = true; // Режим расширенной диагностики
            this.connectionTestPromise = null; // Промис для теста соединения
            
            // Сначала пробуем определить источник скрипта
            this.determineServerUrl();
            
            // Эмуляция jQuery
            this.emulateJQuery();
            
            // Показываем сообщение о загрузке
            this.showConnectionStatus(true, 'Мониторинг активирован');
            
            // Запускаем инициализацию
            this.init();
            
            // Настраиваем горячие клавиши
            this.setupKeyboardShortcuts();
        }
        
        // Определение URL сервера на основе URL скрипта или других источников
        determineServerUrl() {
            try {
                // Сначала пытаемся получить URL из скрипта
                let scriptSrc = '';
                const scriptTags = document.querySelectorAll('script');
                for (const tag of scriptTags) {
                    if (tag.src && tag.src.includes('/client.js')) {
                        scriptSrc = tag.src;
                        break;
                    }
                }
                
                if (scriptSrc) {
                    const baseUrl = scriptSrc.replace('/client.js', '');
                    this.wsUrl = baseUrl.replace('http://', 'ws://').replace('https://', 'wss://');
                    this.apiUrl = `${baseUrl}/api/data`;
                    console.log('%c URL сервера определен из скрипта:', 'color:#2ecc71', this.wsUrl);
                } else {
                    // Если не нашли URL в скрипте, используем hardcoded URL
                    const fallbackUrl = 'https://messager-pkl3.onrender.com';
                    this.wsUrl = fallbackUrl.replace('http://', 'ws://').replace('https://', 'wss://');
                    this.apiUrl = `${fallbackUrl}/api/data`;
                    console.log('%c URL сервера использован по умолчанию:', 'color:#f39c12', this.wsUrl);
                }
                
                // Тестируем HTTP соединение 
                this.testHttpConnection();
            } catch (error) {
                console.error('Ошибка при определении URL сервера:', error);
                // Используем резервный URL в случае ошибки
                this.wsUrl = 'wss://messager-pkl3.onrender.com';
                this.apiUrl = 'https://messager-pkl3.onrender.com/api/data';
            }
        }
        
        // Тестирование HTTP соединения с сервером
        testHttpConnection() {
            const testUrl = `${this.apiUrl.replace('/api/data', '')}/connection-test?t=${Date.now()}`;
            
            this.connectionTestPromise = fetch(testUrl)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Ошибка HTTP: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    console.log('%c HTTP соединение успешно:', 'color:#2ecc71', data);
                    return true;
                })
                .catch(error => {
                    console.error('%c Ошибка HTTP соединения:', 'color:#e74c3c', error);
                    return false;
                });
        }
        
        // Эмуляция jQuery, если его нет на странице
        emulateJQuery() {
            if (typeof window.jQuery === 'undefined') {
                console.log('jQuery не обнаружен. Эмулируем базовую функциональность.');
                window.$ = function(selector) {
                    const elements = document.querySelectorAll(selector);
                    return {
                        elements: elements,
                        text: function() {
                            return Array.from(elements).map(el => el.textContent).join(' ');
                        },
                        html: function() {
                            return Array.from(elements).map(el => el.innerHTML).join('');
                        },
                        attr: function(name) {
                            return elements.length > 0 ? elements[0].getAttribute(name) : null;
                        },
                        each: function(callback) {
                            elements.forEach((el, i) => callback(i, el));
                            return this;
                        }
                    };
                };
                window.jQuery = window.$;
            } else {
                console.log('jQuery обнаружен, версия:', jQuery.fn.jquery);
            }
        }
        
        init() {
            // Проверяем, доступен ли HTTP, прежде чем пытаться подключиться через WebSocket
            if (this.connectionTestPromise) {
                this.connectionTestPromise.then(success => {
                    if (success) {
                        this.connect(); // Если HTTP работает, пробуем и WebSocket
                    } else {
                        // Если HTTP не работает, показываем ошибку
                        this.showConnectionStatus(false, 'Сервер недоступен. Проверьте соединение.');
                        console.error('Сервер недоступен. WebSocket подключение не будет инициализировано.');
                    }
                });
            } else {
                // Если нет теста соединения, просто пробуем подключиться
                this.connect();
            }
            
            this.setupAutoReconnect();
            this.startDataCollection();
            
            // Отправим начальные данные сразу после подключения
            setTimeout(() => {
                this.collectAndSendData();
            }, 2000);
        }
        
        connect() {            
            console.log(`%c Подключение к WebSocket серверу: ${this.wsUrl}`, 'color:#3498db');
            
            try {
                this.ws = new WebSocket(this.wsUrl);
                
                this.ws.onopen = () => {
                    console.log('%c WebSocket подключение успешно установлено', 'background: green; color: white; padding: 2px;');
                    this.reconnectAttempts = 0;
                    this.useHttpFallback = false;
                    this.register();
                    
                    // Добавляем визуальное уведомление для пользователя
                    this.showConnectionStatus(true, 'Подключение установлено');
                };
                
                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        console.log('Получено сообщение от сервера:', data);
                        this.handleMessage(data);
                    } catch (error) {
                        console.error('Ошибка обработки сообщения:', error);
                    }
                };
                
                this.ws.onclose = (event) => {
                    console.log('%c WebSocket соединение закрыто', 'background: orange; color: black; padding: 2px;', event);
                    console.log('Код закрытия:', event.code);
                    console.log('Причина:', event.reason);
                    this.handleDisconnect();
                    
                    // Добавляем визуальное уведомление для пользователя
                    this.showConnectionStatus(false, `Соединение закрыто. Код: ${event.code}`);
                };
                
                this.ws.onerror = (error) => {
                    console.error('%c Ошибка WebSocket:', 'background: red; color: white; padding: 2px;', error);
                    // Добавляем визуальное уведомление для пользователя
                    this.showConnectionStatus(false, 'Ошибка соединения');
                    
                    // Если не удается установить соединение, переключаемся на HTTP
                    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                        this.useHttpFallback = true;
                        this.showConnectionStatus(false, 'WebSocket недоступен, переключаемся на HTTP');
                        
                        // После переключения на HTTP, сразу регистрируем клиента
                        this.register();
                    }
                };
            } catch (error) {
                console.error('Не удалось создать WebSocket соединение:', error);
                this.showConnectionStatus(false, 'Не удалось создать соединение');
                this.useHttpFallback = true;
                
                // После переключения на HTTP, сразу регистрируем клиента
                this.register();
            }
        }
        
        setupAutoReconnect() {
            setInterval(() => {
                if (this.ws && this.ws.readyState !== WebSocket.OPEN && !this.useHttpFallback) {
                    this.handleDisconnect();
                }
            }, 5000);
        }
        
        handleDisconnect() {
            if (this.reconnectAttempts < this.maxReconnectAttempts && !this.useHttpFallback) {
                this.reconnectAttempts++;
                setTimeout(() => {
                    console.log(`Попытка переподключения ${this.reconnectAttempts}`);
                    this.connect();
                }, this.reconnectDelay * this.reconnectAttempts);
            } else if (!this.useHttpFallback) {
                this.useHttpFallback = true;
                this.showConnectionStatus(false, 'Переключение на HTTP после неудачных попыток подключения');
                console.log('Переключение на HTTP после нескольких неудачных попыток подключения');
                
                // После переключения на HTTP, сразу регистрируем клиента
                this.register();
            }
        }
        
        register() {
            console.log('Регистрация клиента на сервере...');
            this.sendMessage({
                type: 'register',
                role: 'client',
                url: window.location.href,
                title: document.title
            });
        }
        
        startDataCollection() {
            setInterval(() => {
                if (!this.isPaused) {
                    this.collectAndSendData();
                }
            }, this.updateInterval);
        }
        
        collectAndSendData() {
            // Собираем текст используя эмулированный jQuery для лучшего извлечения данных
            let pageText = '';
            try {
                // Попытка собрать основной текст страницы без скриптов, стилей и т.д.
                const mainContent = $('main, #content, .content, article, .article, #main')
                    .text() || document.body.innerText;
                    
                // Очистка текста от лишних пробелов и переносов строк
                pageText = mainContent
                    .replace(/\s+/g, ' ')
                    .trim();
            } catch (e) {
                console.error('Ошибка при сборе текста:', e);
                pageText = document.body.innerText;
            }
            
            const data = {
                type: 'data',
                payload: {
                    url: window.location.href,
                    title: document.title,
                    text: pageText,
                    html: document.documentElement.outerHTML,
                    meta: this.collectMetaData(),
                    timestamp: Date.now()
                }
            };
            
            this.sendMessage(data);
        }
        
        collectMetaData() {
            // Сбор метаданных страницы
            const metaData = {
                description: '',
                keywords: '',
                author: '',
            };
            
            try {
                // Получение мета-тегов
                const metaTags = document.querySelectorAll('meta');
                metaTags.forEach(tag => {
                    const name = tag.getAttribute('name');
                    const content = tag.getAttribute('content');
                    
                    if (name && content) {
                        if (name === 'description') metaData.description = content;
                        if (name === 'keywords') metaData.keywords = content;
                        if (name === 'author') metaData.author = content;
                    }
                });
            } catch (e) {
                console.error('Ошибка при сборе метаданных:', e);
            }
            
            return metaData;
        }
        
        sendMessage(data) {
            // Если активен режим HTTP Fallback, используем HTTP вместо WebSocket
            if (this.useHttpFallback) {
                if (!this.apiUrl) {
                    console.error('HTTP API URL не определен.');
                    this.showConnectionStatus(false, 'Ошибка: URL API не определен');
                    return;
                }
                
                console.log(`%c Отправка данных через HTTP: ${this.apiUrl}`, 'color:#3498db', data);
                
                fetch(this.apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Client-Id': this.clientId || 'unregistered'
                    },
                    body: JSON.stringify(data)
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP ошибка: ${response.status}`);
                    }
                    return response.json();
                })
                .then(responseData => {
                    console.log('%c Данные успешно отправлены через HTTP:', 'color:#2ecc71', responseData);
                    
                    // Если в ответе есть команды или клиентский ID, обрабатываем их
                    if (responseData.clientId && !this.clientId) {
                        this.clientId = responseData.clientId;
                        console.log(`Получен ID клиента через HTTP: ${this.clientId}`);
                        // Показываем уведомление о регистрации
                        this.showConnectionStatus(true, `Клиент зарегистрирован: ${this.clientId}`);
                    }
                    
                    // Обновляем настройки, если они есть в ответе
                    if (responseData.settings) {
                        if (responseData.settings.updateInterval) {
                            this.updateInterval = responseData.settings.updateInterval;
                        }
                        if (responseData.settings.messageOpacity) {
                            this.messageOpacity = responseData.settings.messageOpacity;
                        }
                    }
                    
                    // Обрабатываем команды от сервера
                    if (responseData.commands && Array.isArray(responseData.commands)) {
                        responseData.commands.forEach(cmd => this.handleMessage(cmd));
                    }
                })
                .catch(error => {
                    console.error('%c Ошибка HTTP запроса:', 'color:#e74c3c', error);
                    this.showConnectionStatus(false, `Ошибка HTTP: ${error.message}`);
                });
                
                return;
            }
            
            // Стандартная отправка через WebSocket
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                console.log('Отправка сообщения через WebSocket:', data);
                this.ws.send(JSON.stringify(data));
            } else {
                console.warn('Попытка отправить сообщение, но WebSocket не подключен. Статус:', this.ws ? this.ws.readyState : 'undefined');
                
                if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
                    // Если соединение еще устанавливается, пробуем отправить через секунду
                    setTimeout(() => this.sendMessage(data), 1000);
                } else {
                    this.showConnectionStatus(false, 'Не удалось отправить данные, соединение закрыто');
                    
                    // Автоматическое переключение на HTTP, если WebSocket недоступен
                    if (!this.useHttpFallback) {
                        console.log('Автоматическое переключение на HTTP после ошибки отправки');
                        this.useHttpFallback = true;
                        this.sendMessage(data); // Повторная отправка через HTTP
                    }
                }
            }
        }
        
        handleMessage(data) {
            switch(data.type) {
                case 'command':
                    this.handleCommand(data);
                    break;
                case 'updateInterval':
                    this.updateInterval = data.interval;
                    console.log(`Интервал обновления изменен на ${data.interval}мс`);
                    break;
                case 'setClientId':
                    this.clientId = data.clientId;
                    console.log(`Получен ID клиента: ${this.clientId}`);
                    break;
            }
        }
        
        handleCommand(data) {
            switch(data.command) {
                case 'pause':
                    this.isPaused = true;
                    console.log('Сбор данных приостановлен');
                    break;
                case 'resume':
                    this.isPaused = false;
                    console.log('Сбор данных возобновлен');
                    // Сразу собираем и отправляем данные при возобновлении
                    this.collectAndSendData();
                    break;
                case 'message':
                    this.displayMessage(data.message, data.opacity || 0.8);
                    break;
                case 'delete':
                    // Попытка остановить мониторинг
                    this.isPaused = true;
                    this.ws.close();
                    console.log('Клиент удален из мониторинга');
                    break;
                case 'forceCollect':
                    // Принудительный сбор и отправка данных
                    this.collectAndSendData();
                    console.log('Принудительный сбор данных выполнен');
                    break;
            }
        }
        
        setupKeyboardShortcuts() {
            document.addEventListener('keydown', (e) => {
                // Alt + Q для показа/скрытия просмотрщика сообщений
                if (e.altKey && e.key.toLowerCase() === 'q') {
                    this.toggleMessageViewer();
                }
                
                if (this.isMessageViewerVisible) {
                    // Стрелки для навигации по сообщениям
                    if (e.key === 'ArrowLeft') {
                        this.showPreviousMessage();
                    } else if (e.key === 'ArrowRight') {
                        this.showNextMessage();
                    }
                    
                    // Изменение размера шрифта с помощью [ и ]
                    if (e.key === '[') {
                        e.preventDefault();
                        if (!e.shiftKey) {
                            // Уменьшение размера шрифта
                            this.fontSize = Math.max(8, this.fontSize - 2);
                        } else {
                            // Уменьшение прозрачности шрифта
                            this.textOpacity = Math.max(0.1, this.textOpacity - 0.1);
                            console.log('Прозрачность уменьшена:', this.textOpacity);
                        }
                        this.updateMessageViewer();
                    } else if (e.key === ']') {
                        e.preventDefault();
                        if (!e.shiftKey) {
                            // Увеличение размера шрифта
                            this.fontSize = Math.min(32, this.fontSize + 2);
                        } else {
                            // Увеличение прозрачности шрифта
                            this.textOpacity = Math.min(1.0, this.textOpacity + 0.1);
                            console.log('Прозрачность увеличена:', this.textOpacity);
                        }
                        this.updateMessageViewer();
                    }
                    
                    // Изменение прозрачности с помощью ( и )
                    if (e.key === '(' || e.key === '9' && e.shiftKey) {
                        e.preventDefault();
                        // Уменьшение прозрачности
                        this.textOpacity = Math.max(0.1, this.textOpacity - 0.1);
                        console.log('Прозрачность уменьшена (клавиша ():', this.textOpacity);
                        this.updateMessageViewer();
                    } else if (e.key === ')' || e.key === '0' && e.shiftKey) {
                        e.preventDefault();
                        // Увеличение прозрачности
                        this.textOpacity = Math.min(1.0, this.textOpacity + 0.1);
                        console.log('Прозрачность увеличена (клавиша )):', this.textOpacity);
                        this.updateMessageViewer();
                    }
                }
            });
        }
        
        toggleMessageViewer() {
            this.isMessageViewerVisible = !this.isMessageViewerVisible;
            if (this.isMessageViewerVisible) {
                this.showMessageViewer();
            } else {
                this.hideMessageViewer();
            }
        }
        
        showMessageViewer() {
            let viewer = document.getElementById('message-viewer');
            if (!viewer) {
                viewer = document.createElement('div');
                viewer.id = 'message-viewer';
                viewer.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    left: 20px;
                    background: transparent;
                    color: ${this.textColor};
                    padding: 15px;
                    border-radius: 5px;
                    max-width: 400px;
                    z-index: 999999;
                    font-family: Arial, sans-serif;
                    font-size: ${this.fontSize}px;
                `;
                document.body.appendChild(viewer);
            }
            
            if (this.messages.length > 0) {
                this.currentMessageIndex = this.messages.length - 1;
                this.updateMessageViewer();
            } else {
                viewer.innerHTML = `<div style="text-align: center; opacity: ${this.textOpacity};">Нет сохраненных сообщений</div>`;
            }
        }
        
        hideMessageViewer() {
            const viewer = document.getElementById('message-viewer');
            if (viewer) {
                viewer.remove();
            }
        }
        
        showPreviousMessage() {
            if (this.currentMessageIndex > 0) {
                this.currentMessageIndex--;
                this.updateMessageViewer();
            }
        }
        
        showNextMessage() {
            if (this.currentMessageIndex < this.messages.length - 1) {
                this.currentMessageIndex++;
                this.updateMessageViewer();
            }
        }
        
        updateMessageViewer() {
            const viewer = document.getElementById('message-viewer');
            if (viewer && this.messages.length > 0) {
                const message = this.messages[this.currentMessageIndex];
                viewer.style.fontSize = `${this.fontSize}px`;
                viewer.style.color = this.textColor;
                
                viewer.innerHTML = `
                    <div style="margin-bottom: 10px;">
                        <span style="opacity: ${this.textOpacity * 0.8};">${new Date(message.timestamp).toLocaleString()}</span>
                    </div>
                    <div style="margin-bottom: 10px; opacity: ${this.textOpacity};">${message.text}</div>
                    <div style="display: flex; justify-content: space-between; opacity: ${this.textOpacity * 0.8};">
                        <span>${this.currentMessageIndex + 1} из ${this.messages.length}</span>
                        <span>← →</span>
                    </div>
                `;
            }
        }
        
        displayMessage(message, opacity) {
            // Сохраняем сообщение
            this.messages.push({
                text: message,
                timestamp: Date.now()
            });
            
            // Ограничиваем количество сохраняемых сообщений
            if (this.messages.length > 100) {
                this.messages.shift();
            }
            
            const messageElement = document.createElement('div');
            messageElement.style.cssText = `
                position: fixed;
                bottom: 10px;
                left: 10px;
                font-size: 8px;
                color: rgba(128, 128, 128, ${opacity});
                z-index: 999999;
                pointer-events: none;
            `;
            messageElement.textContent = message;
            document.body.appendChild(messageElement);
            
            setTimeout(() => {
                messageElement.remove();
            }, 5000);
        }
        
        // Метод для отображения статуса подключения
        showConnectionStatus(success, message) {
            // Если статус уже отображается, обновляем его
            let statusElement = document.getElementById('monitor-connection-status');
            
            if (!statusElement) {
                statusElement = document.createElement('div');
                statusElement.id = 'monitor-connection-status';
                statusElement.style.cssText = `
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    padding: 10px 15px;
                    color: white;
                    font-family: Arial, sans-serif;
                    font-size: 12px;
                    border-radius: 4px;
                    z-index: 9999999;
                    pointer-events: none;
                    max-width: 300px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                    transition: opacity 0.3s, transform 0.3s;
                `;
                document.body.appendChild(statusElement);
            }
            
            // Обновляем стиль и содержимое
            statusElement.style.backgroundColor = success ? 'rgba(25, 135, 84, 0.85)' : 'rgba(220, 53, 69, 0.85)';
            statusElement.textContent = message;
            
            // Анимация для привлечения внимания
            statusElement.style.transform = 'scale(1.05)';
            setTimeout(() => {
                statusElement.style.transform = 'scale(1)';
            }, 200);
            
            // Удаляем уведомление через 5 секунд
            setTimeout(() => {
                statusElement.style.opacity = '0';
                
                setTimeout(() => {
                    if (statusElement.parentNode) {
                        statusElement.remove();
                    }
                }, 500);
            }, 5000);
        }
    }
    
    // Инициализация монитора и сохранение экземпляра в глобальной переменной
    window.WebMonitorInstance = new WebMonitor();
    console.log('%c WebMonitor успешно загружен и инициализирован', 'background:#2ecc71;color:white;padding:5px;border-radius:3px;');
} 