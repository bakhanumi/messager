const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Хранилище клиентов и админов
const clients = new Map();
const admins = new Map();

// Настройки по умолчанию
const defaultSettings = {
    updateInterval: 25 * 60 * 1000, // 25 минут
    messageOpacity: 0.8,
    maxClients: 100
};

let settings = { ...defaultSettings };

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

// Маршрут для главной страницы
app.get('/', (req, res) => {
    res.redirect('/bookmarklet');
});

// Middleware для логирования запросов
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Обработка WebSocket подключений
wss.on('connection', (ws, req) => {
    const clientId = generateClientId();
    console.log(`Новое соединение: ${clientId}`);
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
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