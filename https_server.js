const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(__dirname));

// Папка для видео
const videosDir = path.join(__dirname, 'videos');
if (!fs.existsSync(videosDir)) {
    fs.mkdirSync(videosDir);
    console.log('📁 Создана папка для видео');
}

app.use('/videos', express.static(videosDir));

// Хранилища
const users = new Map();
const messages = new Map();
const activeUsers = new Map();
const userSessions = new Map();
let nextUserId = 1;

function getRandomColor() {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7B05E'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Тестовые пользователи
const defaultUsers = ['Анна', 'Михаил', 'Елена', 'Дмитрий', 'Ольга', 'Сергей', 'Мария'];
defaultUsers.forEach(username => {
    const userId = nextUserId++;
    users.set(userId, { 
        id: userId, 
        username, 
        online: false, 
        color: getRandomColor(),
        lastSeen: null
    });
});

console.log(`👥 Загружено ${users.size} пользователей`);

const server = http.createServer(app);
server.timeout = 120000;

const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e8
});

// Очистка старых видео
function cleanOldVideos() {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    fs.readdir(videosDir, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(videosDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                if (now - stats.mtimeMs > maxAge) {
                    fs.unlink(filePath, () => console.log(`🗑️ Удалено: ${file}`));
                }
            });
        });
    });
}
setInterval(cleanOldVideos, 24 * 60 * 60 * 1000);
setTimeout(cleanOldVideos, 5000);

function getUserByUsername(username) {
    return Array.from(users.values()).find(u => u.username === username);
}

function getDialogKey(user1, user2) {
    return [user1, user2].sort().join('_');
}

function getPrivateMessages(user1, user2) {
    const key = getDialogKey(user1, user2);
    return messages.get(key) || [];
}

function savePrivateMessage(from, to, message) {
    const key = getDialogKey(from, to);
    if (!messages.has(key)) {
        messages.set(key, []);
    }
    const dialogMessages = messages.get(key);
    dialogMessages.push(message);
    if (dialogMessages.length > 200) {
        dialogMessages.shift();
    }
}

// ============ SOCKET.IO ============
io.on('connection', (socket) => {
    console.log('🔌 Новое подключение:', socket.id);
    
    socket.on('user:login', (username, callback) => {
        console.log(`👤 Попытка входа: ${username}`);
        try {
            let user = getUserByUsername(username);
            if (!user) {
                const userId = nextUserId++;
                user = { 
                    id: userId, 
                    username, 
                    online: true, 
                    color: getRandomColor(),
                    lastSeen: new Date().toISOString()
                };
                users.set(userId, user);
                console.log(`✨ Создан новый пользователь: ${username}`);
            } else {
                user.online = true;
                user.lastSeen = new Date().toISOString();
                console.log(`👋 Пользователь вошёл: ${username}`);
            }
            activeUsers.set(socket.id, user);
            userSessions.set(username, socket.id);
            const allUsers = Array.from(users.values()).map(u => ({
                id: u.id,
                username: u.username,
                online: u.online,
                color: u.color
            }));
            callback({ success: true, user: { ...user }, allUsers });
            broadcastUsers();
        } catch (error) {
            console.error('❌ Ошибка входа:', error);
            callback({ success: false, error: error.message });
        }
    });
    
    socket.on('user:check', (callback) => {
        const user = activeUsers.get(socket.id);
        if (user) {
            const allUsers = Array.from(users.values()).map(u => ({
                id: u.id,
                username: u.username,
                online: u.online,
                color: u.color
            }));
            callback({ success: true, user: { ...user }, allUsers });
        } else {
            callback({ success: false });
        }
    });
    
    socket.on('messages:history', ({ withUser }, callback) => {
        const currentUser = activeUsers.get(socket.id);
        if (!currentUser) {
            callback({ success: false, error: 'Не авторизован' });
            return;
        }
        const history = getPrivateMessages(currentUser.username, withUser);
        callback({ success: true, messages: history });
    });
    
    socket.on('message:send', ({ to, text, type = 'text' }, callback) => {
        const fromUser = activeUsers.get(socket.id);
        if (!fromUser) {
            callback({ success: false, error: 'Не авторизован' });
            return;
        }
        const toUser = getUserByUsername(to);
        if (!toUser) {
            callback({ success: false, error: 'Пользователь не найден' });
            return;
        }
        const message = {
            id: Date.now(),
            from: fromUser.username,
            to: toUser.username,
            text: text.substring(0, 1000),
            timestamp: new Date().toISOString(),
            type: 'text',
            color: fromUser.color
        };
        savePrivateMessage(fromUser.username, toUser.username, message);
        callback({ success: true, message });
        const recipientSocketId = userSessions.get(toUser.username);
        if (recipientSocketId && activeUsers.has(recipientSocketId)) {
            io.to(recipientSocketId).emit('message:new', message);
        }
        socket.emit('message:new', message);
    });
    
    socket.on('video:send', ({ to, video, duration }, callback) => {
        const fromUser = activeUsers.get(socket.id);
        if (!fromUser) {
            callback({ success: false, error: 'Не авторизован' });
            return;
        }
        const toUser = getUserByUsername(to);
        if (!toUser) {
            callback({ success: false, error: 'Пользователь не найден' });
            return;
        }
        if (!video) {
            callback({ success: false, error: 'Нет данных видео' });
            return;
        }
        let base64Data = video;
        if (base64Data.includes(',')) {
            base64Data = base64Data.split(',')[1];
        }
        const videoFilename = `video_${Date.now()}_${Math.random().toString(36).substr(2, 8)}.webm`;
        const videoPath = path.join(videosDir, videoFilename);
        fs.writeFile(videoPath, base64Data, { encoding: 'base64' }, (err) => {
            if (err) {
                console.error('❌ Ошибка сохранения:', err);
                callback({ success: false, error: 'Ошибка сохранения видео' });
                return;
            }
            const message = {
                id: Date.now(),
                from: fromUser.username,
                to: toUser.username,
                videoUrl: `/videos/${videoFilename}`,
                duration: duration || 5,
                timestamp: new Date().toISOString(),
                type: 'video',
                color: fromUser.color
            };
            savePrivateMessage(fromUser.username, toUser.username, message);
            callback({ success: true, message });
            const recipientSocketId = userSessions.get(toUser.username);
            if (recipientSocketId && activeUsers.has(recipientSocketId)) {
                io.to(recipientSocketId).emit('message:new', message);
            }
            socket.emit('message:new', message);
        });
    });
    
    socket.on('user:typing', ({ to, isTyping }) => {
        const fromUser = activeUsers.get(socket.id);
        if (!fromUser) return;
        const toUser = getUserByUsername(to);
        if (!toUser) return;
        const recipientSocketId = userSessions.get(toUser.username);
        if (recipientSocketId && activeUsers.has(recipientSocketId)) {
            io.to(recipientSocketId).emit('user:typing', {
                from: fromUser.username,
                isTyping
            });
        }
    });
    
    socket.on('disconnect', (reason) => {
        const user = activeUsers.get(socket.id);
        if (user) {
            user.online = false;
            user.lastSeen = new Date().toISOString();
            activeUsers.delete(socket.id);
            userSessions.delete(user.username);
            broadcastUsers();
            console.log(`👋 Отключился: ${user.username} (${reason})`);
        }
    });
});

function broadcastUsers() {
    const onlineUsers = Array.from(activeUsers.values());
    io.emit('users:list', onlineUsers);
}

// API
app.get('/api/users', (req, res) => {
    const allUsers = Array.from(users.values());
    res.json(allUsers);
});

app.get('/api/stats', (req, res) => {
    let videosCount = 0, videosSize = 0;
    if (fs.existsSync(videosDir)) {
        const files = fs.readdirSync(videosDir);
        videosCount = files.length;
        files.forEach(file => {
            const stats = fs.statSync(path.join(videosDir, file));
            videosSize += stats.size;
        });
    }
    let totalMessages = 0;
    for (const dialogMessages of messages.values()) {
        totalMessages += dialogMessages.length;
    }
    res.json({
        dialogsCount: messages.size,
        totalMessages: totalMessages,
        users: users.size,
        onlineUsers: activeUsers.size,
        videos: { count: videosCount, sizeMB: (videosSize / 1024 / 1024).toFixed(2) }
    });
});

server.listen(PORT, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 СЕРВЕР ЗАПУЩЕН`);
    console.log(`${'='.repeat(60)}`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`\n💬 Личные сообщения с сохранением истории`);
    console.log(`${'='.repeat(60)}\n`);
});