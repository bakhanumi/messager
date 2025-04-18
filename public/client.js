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
            this.isSocketOpen = false;
            this.connectionAttempts = 0;
            this.maxConnectionAttempts = 5;
            this.reconnectTimeout = null;
            this.collectionInterval = 5000; // Интервал сбора данных по умолчанию
            this.dataCollectionTimer = null;
            this.host = window.location.hostname;
            this.messageQueue = [];
            this.currentMessageIndex = -1;
            this.isMessageViewerVisible = false;
            this.messageHistory = []; // История сообщений
            this.updateInterval = 25 * 60 * 1000; // 25 минут
            this.reconnectAttempts = 0;
            this.maxReconnectAttempts = 5;
            this.reconnectDelay = 1000;
            this.useHttpFallback = false; // Флаг для использования HTTP вместо WebSocket
            this.messages = []; // Массив для хранения сообщений
            this.textColor = '#D3D3D3'; // Светло-серый цвет
            this.apiUrl = null; // URL для HTTP API
            this.diagnostic = true; // Режим расширенной диагностики
            this.connectionTestPromise = null; // Промис для теста соединения
            this.fontSize = 14; // Размер шрифта для сообщений
            this.textOpacity = 0.8; // Прозрачность текста
            
            // Загрузка сохраненных сообщений из localStorage
            this.loadMessages();
            
            // Определяем URL для WebSocket
            let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            let host = window.location.hostname;
            let port = '';
            
            if (window.location.port) {
                port = ':' + window.location.port;
            }
            
            this.wsUrl = `${protocol}//${host}${port}`;
            
            // Настраиваем горячие клавиши для навигации по сообщениям
            document.addEventListener('keydown', (e) => {
                // Alt+Q - показать/скрыть просмотрщик сообщений
                if (e.altKey && e.key.toLowerCase() === 'q') {
                    e.preventDefault();
                    this.toggleMessageViewer();
                }
                
                // Навигация по сообщениям с помощью стрелок
                if (this.isMessageViewerVisible) {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        this.navigateMessages(e.key === 'ArrowUp' ? -1 : 1);
                    }
                }
            });
            
            // Попытка подключения к серверу
            this.determineServerUrl();
            this.connect();
            this.startDataCollection();
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
        
        // Инициализация и установка интервалов сбора данных
        startDataCollection() {
            setInterval(() => {
                if (!this.isPaused) {
                    this.collectAndSendData();
                }
            }, this.updateInterval);
            
            // Отправим начальные данные сразу после подключения
            setTimeout(() => {
                this.collectAndSendData();
            }, 2000);
        }
        
        // Подключение к WebSocket серверу
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
                    this.isSocketOpen = true;
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
                    this.isSocketOpen = false;
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
        
        // Обработка разрыва соединения и повторные попытки
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
        
        // Регистрация клиента на сервере
        register() {
            console.log('Регистрация клиента на сервере...');
            this.sendMessage({
                type: 'register',
                role: 'client',
                url: window.location.href,
                title: document.title
            });
        }
        
        // Сбор данных страницы для отправки на сервер
        collectAndSendData() {
            this.emulateJQuery(); // Убедимся, что jQuery доступен
            
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
                    meta: this.collectMetaData(),
                    timestamp: Date.now()
                }
            };
            
            this.sendMessage(data);
        }
        
        // Сбор метаданных страницы
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
        
        // Отправка сообщения на сервер (через WebSocket или HTTP)
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
        
        // Обработка сообщений от сервера
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
        
        // Обработка команд от сервера
        handleCommand(data) {
            console.log('Получена команда:', data);
            
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
                    // Отображаем и сохраняем сообщение
                    this.displayMessage(data.message, data.opacity || 0.8);
                    this.saveMessage(data.message, { opacity: data.opacity || 0.8 });
                    break;
                case 'delete':
                    // Попытка остановить мониторинг
                    this.isPaused = true;
                    if (this.ws) this.ws.close();
                    console.log('Клиент удален из мониторинга');
                    break;
                case 'forceCollect':
                    // Принудительный сбор и отправка данных
                    this.collectAndSendData();
                    console.log('Принудительный сбор данных выполнен');
                    break;
            }
        }
        
        // Отображение сообщения на экране
        displayMessage(text, opacity = 0.8) {
            // Сохраняем сообщение в массив
            this.messages.push({
                text: text,
                timestamp: Date.now()
            });
            
            // Ограничиваем количество сохраняемых сообщений
            if (this.messages.length > 100) {
                this.messages.shift();
            }
            
            // Отображаем маленькое уведомление
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
            messageElement.textContent = text;
            document.body.appendChild(messageElement);
            
            // Удаляем через 5 секунд
            setTimeout(() => {
                if (messageElement.parentNode) {
                    messageElement.remove();
                }
            }, 5000);
        }
        
        // Сохранение сообщения в историю
        saveMessage(text, options = {}) {
            const message = {
                text: text,
                options: options,
                timestamp: new Date().toISOString(),
                url: window.location.href,
                title: document.title
            };
            
            this.messageHistory.push(message);
            
            // Сохраняем в localStorage
            try {
                localStorage.setItem('webMonitorMessages', JSON.stringify(this.messageHistory.slice(-100)));
            } catch (e) {
                console.error('Ошибка при сохранении сообщений в localStorage:', e);
            }
        }
        
        // Загрузка сообщений из localStorage
        loadMessages() {
            try {
                const savedMessages = localStorage.getItem('webMonitorMessages');
                if (savedMessages) {
                    this.messageHistory = JSON.parse(savedMessages);
                    console.log(`Загружено ${this.messageHistory.length} сообщений из localStorage`);
                }
            } catch (e) {
                console.error('Ошибка при загрузке истории сообщений:', e);
                this.messageHistory = [];
            }
        }
        
        // Показать статус подключения
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
        
        // Переключение просмотрщика сообщений
        toggleMessageViewer() {
            this.isMessageViewerVisible = !this.isMessageViewerVisible;
            if (this.isMessageViewerVisible) {
                this.showMessageViewer();
            } else {
                this.hideMessageViewer();
            }
        }
        
        // Показать просмотрщик сообщений
        showMessageViewer() {
            // Удаляем существующий, если есть
            this.hideMessageViewer();
            
            // Создаем контейнер для просмотрщика
            const viewer = document.createElement('div');
            viewer.id = 'web-monitor-message-viewer';
            viewer.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background-color: rgba(0, 0, 0, 0.85);
                color: white;
                width: 400px;
                max-height: 80vh;
                border-radius: 8px;
                overflow: hidden;
                z-index: 2147483647;
                display: flex;
                flex-direction: column;
                box-shadow: 0 5px 25px rgba(0, 0, 0, 0.5);
            `;
            
            // Создаем заголовок
            const header = document.createElement('div');
            header.style.cssText = `
                padding: 12px 15px;
                background-color: #1e1e1e;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #444;
            `;
            
            const title = document.createElement('div');
            title.textContent = 'История сообщений';
            title.style.cssText = `
                font-weight: bold;
                font-size: 16px;
            `;
            
            const closeButton = document.createElement('button');
            closeButton.textContent = '×';
            closeButton.style.cssText = `
                background: none;
                border: none;
                color: white;
                font-size: 24px;
                cursor: pointer;
                padding: 0;
                line-height: 1;
            `;
            closeButton.addEventListener('click', () => this.toggleMessageViewer());
            
            header.appendChild(title);
            header.appendChild(closeButton);
            
            // Создаем контейнер для списка сообщений
            const messageList = document.createElement('div');
            messageList.style.cssText = `
                flex: 1;
                overflow-y: auto;
                padding: 10px 0;
                max-height: calc(80vh - 130px);
            `;
            
            // Создаем элементы для каждого сообщения
            if (this.messageHistory.length === 0) {
                const emptyState = document.createElement('div');
                emptyState.style.cssText = `
                    text-align: center;
                    padding: 30px 20px;
                    color: #aaa;
                    font-style: italic;
                `;
                emptyState.textContent = 'Нет сохраненных сообщений';
                messageList.appendChild(emptyState);
            } else {
                this.messageHistory.forEach((message, index) => {
                    const messageItem = document.createElement('div');
                    messageItem.className = 'message-item';
                    messageItem.dataset.index = index;
                    messageItem.style.cssText = `
                        padding: 12px 15px;
                        border-bottom: 1px solid #333;
                        cursor: pointer;
                        transition: background-color 0.2s;
                    `;
                    messageItem.addEventListener('mouseover', () => {
                        messageItem.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    });
                    messageItem.addEventListener('mouseout', () => {
                        if (index !== this.currentMessageIndex) {
                            messageItem.style.backgroundColor = '';
                        }
                    });
                    messageItem.addEventListener('click', () => {
                        this.currentMessageIndex = index;
                        this.highlightSelectedMessage();
                        this.displayMessageDetails(message);
                    });
                    
                    // Добавляем метку времени
                    const timestamp = new Date(message.timestamp);
                    const timeStr = timestamp.toLocaleTimeString();
                    const dateStr = timestamp.toLocaleDateString();
                    
                    messageItem.innerHTML = `
                        <div style="font-weight: bold; margin-bottom: 5px; word-break: break-word;">${message.text}</div>
                        <div style="font-size: 12px; color: #bbb;">${dateStr} ${timeStr}</div>
                    `;
                    
                    messageList.appendChild(messageItem);
                });
            }
            
            // Создаем контейнер для деталей выбранного сообщения
            const detailsContainer = document.createElement('div');
            detailsContainer.id = 'message-details';
            detailsContainer.style.cssText = `
                padding: 15px;
                background-color: #2a2a2a;
                border-top: 1px solid #444;
                display: none;
            `;
            
            // Создаем подсказку навигации
            const helpText = document.createElement('div');
            helpText.style.cssText = `
                padding: 10px 15px;
                background-color: #1e1e1e;
                border-top: 1px solid #444;
                font-size: 12px;
                color: #aaa;
                text-align: center;
            `;
            helpText.innerHTML = '↑/↓ - навигация по сообщениям · <b>Alt+Q</b> - закрыть';
            
            // Собираем все вместе
            viewer.appendChild(header);
            viewer.appendChild(messageList);
            viewer.appendChild(detailsContainer);
            viewer.appendChild(helpText);
            
            document.body.appendChild(viewer);
            this.isMessageViewerVisible = true;
            
            // Если есть сообщения, выбираем последнее
            if (this.messageHistory.length > 0) {
                this.currentMessageIndex = this.messageHistory.length - 1;
                this.highlightSelectedMessage();
                this.displayMessageDetails(this.messageHistory[this.currentMessageIndex]);
            }
        }
        
        // Скрыть просмотрщик сообщений
        hideMessageViewer() {
            const viewer = document.getElementById('web-monitor-message-viewer');
            if (viewer) {
                viewer.parentNode.removeChild(viewer);
            }
            this.isMessageViewerVisible = false;
        }
        
        // Подсветить выбранное сообщение
        highlightSelectedMessage() {
            const items = document.querySelectorAll('.message-item');
            items.forEach(item => {
                item.style.backgroundColor = '';
                if (parseInt(item.dataset.index) === this.currentMessageIndex) {
                    item.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                    // Прокрутить к выбранному элементу
                    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
        }
        
        // Отобразить детали сообщения
        displayMessageDetails(message) {
            const container = document.getElementById('message-details');
            if (!container) return;
            
            container.style.display = 'block';
            
            const timestamp = new Date(message.timestamp);
            
            container.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 10px; font-size: 16px;">${message.text}</div>
                <div style="margin-bottom: 8px;">
                    <span style="color: #aaa;">Время:</span> 
                    ${timestamp.toLocaleString()}
                </div>
                <div style="margin-bottom: 8px;">
                    <span style="color: #aaa;">URL:</span> 
                    <a href="${message.url}" target="_blank" style="color: #4d9cf6; text-decoration: none;">${message.url}</a>
                </div>
                <div>
                    <span style="color: #aaa;">Заголовок страницы:</span> 
                    ${message.title}
                </div>
            `;
        }
        
        // Навигация по сообщениям
        navigateMessages(direction) {
            if (this.messageHistory.length === 0) return;
            
            let newIndex = this.currentMessageIndex + direction;
            
            // Циклическая навигация: если достигли конца списка, переходим к началу
            if (newIndex < 0) {
                newIndex = this.messageHistory.length - 1;
            } else if (newIndex >= this.messageHistory.length) {
                newIndex = 0;
            }
            
            this.currentMessageIndex = newIndex;
            this.highlightSelectedMessage();
            this.displayMessageDetails(this.messageHistory[this.currentMessageIndex]);
        }
    }
    
    // Инициализация монитора и сохранение экземпляра в глобальной переменной
    window.WebMonitorInstance = new WebMonitor();
    console.log('%c WebMonitor успешно загружен и инициализирован', 'background:#2ecc71;color:white;padding:5px;border-radius:3px;');
} else {
    console.log('%c WebMonitor уже загружен на этой странице', 'background:#f39c12;color:white;padding:5px;border-radius:3px;');
}
