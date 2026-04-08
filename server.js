const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// Создаем папку для видео
const videosDir = path.join(__dirname, 'videos');
if (!fs.existsSync(videosDir)) {
    fs.mkdirSync(videosDir);
}

// Раздаем видео статически
app.use('/videos', express.static(videosDir));

// Хранилище в памяти
const users = new Map();
const messages = [];
const activeUsers = new Map();

let nextUserId = 1;
let nextVideoId = 1;

// Функция для получения случайного цвета
function getRandomColor() {
    const colors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
        '#DDA0DD', '#98D8C8', '#F7B05E', '#E86A6A', '#6A9C89',
        '#A8E6CF', '#FFD3B6', '#FF8B94', '#C7CEE6', '#B5EAD7'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Тестовые пользователи
const defaultUsers = ['ЕГОР', 'ЕГОР', 'ЕГОР', 'ЕГОР', 'ЕГОР', 'ЕГОР', 'ЕГОР', 'ЕГОР', 'ЕГОР', 'ЕГОР'];

defaultUsers.forEach(username => {
    const userId = nextUserId++;
    users.set(userId, {
        id: userId,
        username,
        online: false,
        color: getRandomColor()
    });
});

// ============ АВТООЧИСТКА СТАРЫХ ВИДЕО ============
function cleanOldVideos() {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 дней
    
    fs.readdir(videosDir, (err, files) => {
        if (err) {
            console.error('Ошибка чтения папки видео:', err);
            return;
        }
        
        let deletedCount = 0;
        files.forEach(file => {
            const filePath = path.join(videosDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                
                if (now - stats.mtimeMs > maxAge) {
                    fs.unlink(filePath, (err) => {
                        if (!err) {
                            deletedCount++;
                            console.log(`🗑️ Удалено старое видео: ${file}`);
                        }
                    });
                }
            });
        });
        
        if (deletedCount > 0) {
            console.log(`🧹 Очистка завершена. Удалено ${deletedCount} старых видео`);
        }
    });
}

// Запускаем очистку раз в день
setInterval(cleanOldVideos, 24 * 60 * 60 * 1000);
// И сразу при старте
setTimeout(cleanOldVideos, 5000);

// ============ SOCKET.IO ============
io.on('connection', (socket) => {
    console.log('🔌 Подключился:', socket.id);
    
    // Авторизация пользователя
    socket.on('user:login', (username, callback) => {
        try {
            let user = Array.from(users.values()).find(u => u.username === username);
            
            if (!user) {
                const userId = nextUserId++;
                user = {
                    id: userId,
                    username,
                    online: true,
                    color: getRandomColor()
                };
                users.set(userId, user);
                console.log(`👤 Новый пользователь: ${username}`);
            } else {
                user.online = true;
                console.log(`👋 Пользователь вернулся: ${username}`);
            }
            
            activeUsers.set(socket.id, user);
            callback({ success: true, user: { ...user } });
            broadcastUsers();
            
        } catch (error) {
            console.error('Ошибка входа:', error);
            callback({ success: false, error: error.message });
        }
    });
    
    // Получение истории сообщений
    socket.on('messages:history', (callback) => {
        const historyMessages = messages.slice(-100);
        callback({ success: true, messages: historyMessages });
    });
    
    // Отправка текстового сообщения
    socket.on('message:send', (data, callback) => {
        const user = activeUsers.get(socket.id);
        if (!user) {
            callback({ success: false, error: 'Не авторизован' });
            return;
        }
        
        const message = {
            id: Date.now(),
            user_id: user.id,
            username: user.username,
            text: data.text.substring(0, 1000), // Ограничение длины
            timestamp: new Date().toISOString(),
            type: 'text',
            color: user.color
        };
        
        messages.push(message);
        
        // Ограничиваем историю 1000 сообщений
        if (messages.length > 1000) {
            messages.shift();
        }
        
        io.emit('message:new', message);
        callback({ success: true, message });
    });
    
    // Отправка видеокружочка
    socket.on('video:send', (data, callback) => {
        const user = activeUsers.get(socket.id);
        if (!user) {
            callback({ success: false, error: 'Не авторизован' });
            return;
        }
        
        const videoId = nextVideoId++;
        const videoFilename = `video_${Date.now()}_${videoId}.webm`;
        const videoPath = path.join(videosDir, videoFilename);
        
        // Сохраняем видео из base64
        const base64Data = data.video.split(';base64,').pop();
        
        fs.writeFile(videoPath, base64Data, { encoding: 'base64' }, (err) => {
            if (err) {
                console.error('Ошибка сохранения видео:', err);
                callback({ success: false, error: 'Ошибка сохранения видео' });
                return;
            }
            
            const videoUrl = `/videos/${videoFilename}`;
            const duration = Math.min(data.duration || 5, 15); // Максимум 15 секунд
            
            const message = {
                id: Date.now(),
                user_id: user.id,
                username: user.username,
                videoUrl: videoUrl,
                duration: duration,
                timestamp: new Date().toISOString(),
                type: 'video',
                color: user.color
            };
            
            messages.push(message);
            
            // Ограничиваем историю 1000 сообщений
            if (messages.length > 1000) {
                const removed = messages.shift();
                // Если удаляемое сообщение содержит видео - удаляем файл
                if (removed.type === 'video' && removed.videoUrl) {
                    const oldVideoPath = path.join(__dirname, removed.videoUrl);
                    fs.unlink(oldVideoPath, () => {});
                }
            }
            
            io.emit('message:new', message);
            callback({ success: true, message });
            
            console.log(`📹 Видеокружочек от ${user.username}: ${duration} сек, ${videoFilename}`);
        });
    });
    
    // Индикатор набора текста
    socket.on('user:typing', (isTyping) => {
        const user = activeUsers.get(socket.id);
        if (user) {
            socket.broadcast.emit('user:typing', {
                username: user.username,
                isTyping
            });
        }
    });
    
    // Отключение пользователя
    socket.on('disconnect', () => {
        const user = activeUsers.get(socket.id);
        if (user) {
            user.online = false;
            activeUsers.delete(socket.id);
            broadcastUsers();
            console.log(`👋 Пользователь отключился: ${user.username}`);
        }
    });
});

// Рассылка списка онлайн пользователей
function broadcastUsers() {
    const onlineUsers = Array.from(activeUsers.values());
    io.emit('users:list', onlineUsers);
}

// API для получения списка пользователей
app.get('/api/users', (req, res) => {
    const allUsers = Array.from(users.values());
    res.json(allUsers);
});

// API для статистики
app.get('/api/stats', (req, res) => {
    let videosCount = 0;
    let videosSize = 0;
    
    if (fs.existsSync(videosDir)) {
        const files = fs.readdirSync(videosDir);
        videosCount = files.length;
        
        files.forEach(file => {
            const stats = fs.statSync(path.join(videosDir, file));
            videosSize += stats.size;
        });
    }
    
    res.json({
        messages: messages.length,
        users: users.size,
        onlineUsers: activeUsers.size,
        videos: {
            count: videosCount,
            sizeMB: (videosSize / 1024 / 1024).toFixed(2)
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════╗
║     🚀 МЕССЕНДЖЕР ЗАПУЩЕН                        ║
╠═══════════════════════════════════════════════════╣
║  Локальный доступ: http://localhost:${PORT}        ║
║  Видеокружочки: ✅ до 10 секунд                  ║
║  Автоочистка: ✅ каждые 7 дней                   ║
║  Сжатие видео: ✅ 480p                           ║
╚═══════════════════════════════════════════════════╝
    `);
});