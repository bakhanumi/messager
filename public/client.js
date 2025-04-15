class WebMonitor {
    constructor() {
        this.ws = null;
        this.clientId = null;
        this.isPaused = false;
        this.updateInterval = 25 * 60 * 1000; // 25 минут
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.messages = []; // Массив для хранения сообщений
        this.currentMessageIndex = -1; // Индекс текущего отображаемого сообщения
        this.isMessageViewerVisible = false; // Флаг видимости просмотрщика сообщений
        this.fontSize = 14; // Начальный размер шрифта
        this.textOpacity = 0.9; // Начальная прозрачность шрифта
        this.textColor = '#D3D3D3'; // Светло-серый цвет
        
        // Эмуляция jQuery
        this.emulateJQuery();
        
        this.init();
        this.setupKeyboardShortcuts();
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
        this.connect();
        this.setupAutoReconnect();
        this.startDataCollection();
        
        // Отправим начальные данные сразу после подключения
        setTimeout(() => {
            this.collectAndSendData();
        }, 2000);
    }
    
    connect() {
        // Динамически определяем WebSocket URL на основе текущего хоста
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host || 'localhost:3000';
        const wsUrl = `${protocol}//${host}`;
        
        console.log(`Подключение к WebSocket серверу: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('Подключено к серверу');
            this.reconnectAttempts = 0;
            this.register();
        };
        
        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (error) {
                console.error('Ошибка обработки сообщения:', error);
            }
        };
        
        this.ws.onclose = () => {
            console.log('Соединение закрыто');
            this.handleDisconnect();
        };
        
        this.ws.onerror = (error) => {
            console.error('Ошибка WebSocket:', error);
        };
    }
    
    setupAutoReconnect() {
        setInterval(() => {
            if (this.ws.readyState !== WebSocket.OPEN) {
                this.handleDisconnect();
            }
        }, 5000);
    }
    
    handleDisconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => {
                console.log(`Попытка переподключения ${this.reconnectAttempts}`);
                this.connect();
            }, this.reconnectDelay * this.reconnectAttempts);
        }
    }
    
    register() {
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
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
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
}

// Инициализация монитора
const monitor = new WebMonitor(); 