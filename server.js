const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Обязательно добавляем парсер JSON для обработки HTTP запросов
app.use(express.json({ limit: '5mb' }));

// Хранилище клиентов и админов
const clients = new Map();
const admins = new Map();
// Хранилище для ожидающих команд для HTTP клиентов
const pendingCommands = new Map();

// Настройки по умолчанию
const defaultSettings = {
    updateInterval: 25 * 60 * 1000, // 25 минут
    messageOpacity: 0.8,
    maxClients: 100
};

let settings = { ...defaultSettings };

// Middleware для логирования запросов
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - ${req.headers['user-agent'] || 'Unknown UA'}`);
    next();
});

// Настройка CORS (перемещаем до раздачи статических файлов)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Client-Id');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  // Обработка preflight запросов
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Раздача статических файлов
app.use(express.static(path.join(__dirname, 'public')));

// Маршрут для admin.html
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Маршрут для bookmarklet.html
app.get('/bookmarklet', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'bookmarklet.html'));
});

// Маршрут для тестирования WebSocket
app.get('/ws-test', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ws-test.html'));
});

// Маршрут для главной страницы
app.get('/', (req, res) => {
    res.redirect('/bookmarklet');
});

// Добавляем маршрут для проверки состояния WebSocket
app.get('/ws-status', (req, res) => {
    const status = {
        server: 'running',
        websocket: wss.clients ? 'available' : 'unavailable',
        activeAdmins: Array.from(admins.keys()).length,
        activeClients: Array.from(clients.keys()).length,
        serverTime: new Date().toISOString()
    };
    
    console.log('WS Status Check:', status);
    res.json(status);
});

// Маршрут для client.js с правильными заголовками
app.get('/client.js', (req, res) => {
  console.log(`Запрос client.js от ${req.headers['user-agent']} из ${req.headers['referer'] || 'Unknown source'}`);
  res.header('Content-Type', 'application/javascript');
  res.header('Access-Control-Allow-Origin', '*');
  res.sendFile(path.join(__dirname, 'public', 'client.js'));
});

// Добавляем диагностический эндпоинт для проверки соединения
app.get('/connection-test', (req, res) => {
  res.json({
    success: true,
    timestamp: Date.now(),
    message: 'Server is reachable via HTTP',
    cors: 'enabled',
    clientCount: clients.size,
    adminCount: admins.size
  });
});

// HTTP API endpoint для клиентов, у которых не работает WebSocket
app.post('/api/data', (req, res) => {
  const data = req.body;
  const clientId = req.headers['x-client-id'] || null;
  
  console.log(`HTTP API: Получен запрос от клиента ${clientId || 'без ID'}, тип: ${data?.type || 'неизвестно'}`);
  
  let responseData = {
    success: true,
    timestamp: Date.now()
  };
  
  // Обработка данных аналогично WebSocket подключению
  if (data.type === 'register' && data.role === 'client') {
    // Регистрация нового клиента
    const newClientId = clientId || `client_http_${Date.now()}`;
    
    responseData.clientId = newClientId;
    console.log(`Зарегистрирован новый HTTP клиент с ID: ${newClientId}, URL: ${data.url}`);
    
    // Добавляем клиента в список клиентов, если его там еще нет
    if (!clients.has(newClientId)) {
      clients.set(newClientId, {
        id: newClientId,
        isPaused: false,
        data: {
          url: data.url,
          title: data.title,
          lastUpdate: Date.now()
        },
        isHttpClient: true
      });
      
      // Уведомляем всех администраторов о новом клиенте
      broadcastToAdmins({
        type: 'clientList',
        clients: getClientsList()
      });
    } else {
      // Обновляем информацию о существующем клиенте
      const client = clients.get(newClientId);
      client.data.url = data.url;
      client.data.title = data.title;
      client.data.lastUpdate = Date.now();
    }
  } else if (data.type === 'data' && clientId) {
    // Обрабатываем данные от клиента
    const client = clients.get(clientId);
    
    if (client) {
      client.data.lastUpdate = Date.now();
      client.data.title = data.payload?.title || client.data.title;
      
      // Передаем данные всем админам
      broadcastToAdmins({
        type: 'clientData',
        clientId,
        data: data.payload
      });
    } else {
      console.log(`HTTP API: Клиент с ID ${clientId} не найден в списке клиентов`);
    }
  }
  
  // Добавляем команды, которые нужно отправить клиенту
  responseData.commands = [];
  
  // Если у клиента есть ожидающие команды, отправляем их в ответе
  if (clientId && pendingCommands.has(clientId)) {
    responseData.commands = pendingCommands.get(clientId);
    pendingCommands.delete(clientId);
  }
  
  // Возвращаем текущие настройки клиенту
  responseData.settings = {
    updateInterval: settings.updateInterval,
    messageOpacity: settings.messageOpacity
  };
  
  res.json(responseData);
});

// Обработка WebSocket подключений
wss.on('connection', (ws, req) => {
    const clientId = generateClientId();
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    console.log(`Новое соединение: ${clientId}`);
    console.log(`IP клиента: ${ipAddress}`);
    console.log(`User-Agent: ${req.headers['user-agent']}`);
    console.log(`Origin: ${req.headers.origin || 'Не определено'}`);
    
    // Отправляем приветственное сообщение для проверки соединения
    try {
        ws.send(JSON.stringify({
            type: 'welcome',
            message: 'Соединение с сервером установлено',
            timestamp: Date.now()
        }));
    } catch (error) {
        console.error(`Ошибка при отправке приветственного сообщения: ${error}`);
    }
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`Получено сообщение от ${clientId}:`, data.type);
            
            switch(data.type) {
                case 'register':
                    if (data.role === 'admin') {
                        registerAdmin(ws, clientId);
                    } else {
                        registerClient(ws, clientId, data);
                    }
                    break;
                    
                case 'data':
                    handleClientData(clientId, data);
                    break;
                    
                case 'command':
                    handleAdminCommand(data);
                    break;
                    
                case 'updateSettings':
                    updateSettings(data.settings);
                    break;
            }
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    });
    
    ws.on('close', () => {
        handleDisconnection(clientId);
    });
    
    // Обработка ошибок WebSocket
    ws.on('error', (error) => {
        console.error(`WebSocket ошибка для ${clientId}:`, error);
    });
});

// Вспомогательные функции
function generateClientId() {
    return Math.random().toString(36).substr(2, 9);
}

function registerClient(ws, clientId, data) {
    console.log(`Регистрация клиента: ${clientId}, URL: ${data.url}`);
    
    clients.set(clientId, {
        ws,
        isPaused: false,
        data: {
            url: data.url,
            title: data.title,
            lastUpdate: Date.now()
        }
    });
    
    // Отправляем ID клиенту для отслеживания
    ws.send(JSON.stringify({
        type: 'setClientId',
        clientId
    }));
    
    // Отправляем текущий интервал обновления
    ws.send(JSON.stringify({
        type: 'updateInterval',
        interval: settings.updateInterval
    }));
    
    broadcastToAdmins({
        type: 'clientList',
        clients: getClientsList()
    });
}

function registerAdmin(ws, adminId) {
    console.log(`Регистрация админа: ${adminId}`);
    
    admins.set(adminId, { ws });
    
    // Отправляем текущий список клиентов новому админу
    ws.send(JSON.stringify({
        type: 'clientList',
        clients: getClientsList()
    }));
    
    // Отправляем текущие настройки
    ws.send(JSON.stringify({
        type: 'settings',
        settings
    }));
}

function handleClientData(clientId, data) {
    const client = clients.get(clientId);
    
    if (client) {
        // Обновляем время последнего обновления
        client.data.lastUpdate = Date.now();
        client.data.title = data.payload.title || client.data.title;
        
        // Передаем данные всем админам
        broadcastToAdmins({
            type: 'clientData',
            clientId,
            data: data.payload
        });
    }
}

function broadcastToAdmins(message) {
    const messageStr = JSON.stringify(message);
    let activeAdmins = 0;
    
    admins.forEach(admin => {
        if (admin.ws.readyState === WebSocket.OPEN) {
            admin.ws.send(messageStr);
            activeAdmins++;
        }
    });
    
    if (message.type !== 'clientData') { // Избегаем спама в логах
        console.log(`Отправлено сообщение ${message.type} ${activeAdmins} админам`);
    }
}

function handleAdminCommand(data) {
    const { clientId, command } = data;
    
    if (command === 'updateInterval') {
        // Обновление интервала для всех клиентов
        settings.updateInterval = data.interval;
        
        clients.forEach((client, id) => {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({
                    type: 'updateInterval',
                    interval: data.interval
                }));
            }
        });
        
        broadcastToAdmins({
            type: 'settings',
            settings
        });
        
        return;
    }
    
    if (command === 'updateOpacity') {
        // Обновление прозрачности сообщений
        settings.messageOpacity = data.opacity;
        
        broadcastToAdmins({
            type: 'settings',
            settings
        });
        
        return;
    }
    
    // Команды для конкретного клиента
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
        switch(command) {
            case 'pause':
                client.isPaused = true;
                break;
            case 'resume':
                client.isPaused = false;
                break;
            case 'delete':
                // Клиент будет удален после закрытия соединения
                break;
        }
        
        client.ws.send(JSON.stringify(data));
        
        // Обновляем список клиентов для админов
        if (command === 'pause' || command === 'resume') {
            broadcastToAdmins({
                type: 'clientStatus',
                clientId,
                isPaused: client.isPaused
            });
        }
    }
}

function handleDisconnection(clientId) {
    if (clients.has(clientId)) {
        console.log(`Клиент отключился: ${clientId}`);
        clients.delete(clientId);
        broadcastToAdmins({
            type: 'clientDisconnected',
            clientId
        });
    }
    if (admins.has(clientId)) {
        console.log(`Админ отключился: ${clientId}`);
        admins.delete(clientId);
    }
}

function updateSettings(newSettings) {
    settings = { ...settings, ...newSettings };
    
    // Если изменился интервал обновления, оповещаем клиентов
    if (newSettings.updateInterval) {
        clients.forEach((client, id) => {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({
                    type: 'updateInterval',
                    interval: settings.updateInterval
                }));
            }
        });
    }
    
    // Оповещаем всех админов о новых настройках
    broadcastToAdmins({
        type: 'settings',
        settings
    });
}

function getClientsList() {
    return Array.from(clients.entries()).map(([id, client]) => ({
        id,
        isPaused: client.isPaused,
        ...client.data
    }));
}

// Обновляем порт, чтобы использовать переменную окружения PORT, предоставляемую Render
const PORT = process.env.PORT || 3000;

// Найдем место, где создается или запускается сервер и внесем изменения
// Вместо
// server.listen(3000, () => {
//   console.log('Сервер запущен на порту 3000');
// });

// Используем
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Дата и время запуска: ${new Date().toISOString()}`);
}); 