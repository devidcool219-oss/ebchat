// ============ ПОДКЛЮЧЕНИЕ ============
const socket = io({
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 60000
});

let currentUser = null;
let currentChatWith = null;
let allUsers = [];
let typingTimeout = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordStartTime = null;
let recordTimerInterval = null;
let currentStream = null;
let currentCameraDeviceId = null;
let availableCameras = [];
let unreadCounts = {};
let pendingMessages = new Set();

// DOM элементы
const loginScreen = document.getElementById('loginScreen');
const chatApp = document.getElementById('chatApp');
const usernameInput = document.getElementById('usernameInput');
const loginBtn = document.getElementById('loginBtn');
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const videoBtn = document.getElementById('videoBtn');
const usersList = document.getElementById('usersList');
const currentUserDiv = document.getElementById('currentUser');
const onlineCount = document.getElementById('onlineCount');
const menuToggle = document.getElementById('menuToggle');
const closeSidebar = document.getElementById('closeSidebar');
const sidebar = document.getElementById('sidebar');
const typingIndicator = document.getElementById('typingIndicator');
const onlinePreviewCount = document.getElementById('onlinePreviewCount');
const chatTitle = document.getElementById('chatTitle');

// Модальное окно видео
const videoModal = document.getElementById('videoModal');
const videoPreview = document.getElementById('videoPreview');
const startRecordBtn = document.getElementById('startRecordBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const sendVideoBtn = document.getElementById('sendVideoBtn');
const cancelVideoBtn = document.getElementById('cancelVideoBtn');
const closeModal = document.getElementById('closeModal');
const recordTimer = document.getElementById('recordTimer');
const progressBar = document.getElementById('progressBar');
const switchCameraBtn = document.getElementById('switchCameraBtn');

// ============ БРАУЗЕРНЫЕ УВЕДОМЛЕНИЯ ============

async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.log('Браузер не поддерживает уведомления');
        return false;
    }
    
    if (Notification.permission === 'granted') {
        console.log('Уведомления уже разрешены');
        return true;
    }
    
    if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            console.log('✅ Уведомления разрешены');
            showBrowserNotification('🔔 Уведомления включены', 'Теперь вы будете получать уведомления о новых сообщениях');
            return true;
        } else {
            console.log('❌ Уведомления запрещены');
            return false;
        }
    }
    return false;
}

function showBrowserNotification(title, body, tag = null) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    
    const options = {
        body: body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        vibrate: [200, 100, 200],
        silent: false,
        requireInteraction: false
    };
    
    if (tag) options.tag = tag;
    
    const notification = new Notification(title, options);
    setTimeout(() => notification.close(), 5000);
    
    notification.onclick = () => {
        window.focus();
        notification.close();
    };
}

function notifyNewMessage(message) {
    if (message.from === currentUser?.username) return;
    if (currentChatWith && message.from === currentChatWith.username && !document.hidden) return;
    
    const title = `📩 Новое сообщение от ${message.from}`;
    let body = '';
    
    if (message.type === 'video') {
        body = '📹 Видеосообщение';
    } else {
        body = message.text.length > 50 ? message.text.substring(0, 47) + '...' : message.text;
    }
    
    showBrowserNotification(title, body, `msg_${message.id}`);
}

function playNotificationSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 880;
        gainNode.gain.value = 0.3;
        
        oscillator.start();
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.5);
        oscillator.stop(audioContext.currentTime + 0.5);
        
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
    } catch (e) {
        console.log('Звук не поддерживается');
    }
}

function addNotificationButton() {
    if (document.getElementById('notificationBtn')) return;
    
    const notificationBtn = document.createElement('button');
    notificationBtn.id = 'notificationBtn';
    notificationBtn.innerHTML = '🔔';
    notificationBtn.title = 'Включить уведомления';
    notificationBtn.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 20px;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: #667eea;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        z-index: 9999;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        display: none;
        align-items: center;
        justify-content: center;
    `;
    
    notificationBtn.onclick = () => {
        requestNotificationPermission();
        notificationBtn.style.display = 'none';
    };
    
    document.body.appendChild(notificationBtn);
    
    if (Notification.permission !== 'granted') {
        notificationBtn.style.display = 'flex';
    }
}

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    let bgColor = '#667eea';
    if (type === 'error') bgColor = '#ff4757';
    if (type === 'success') bgColor = '#4caf50';
    if (type === 'info') bgColor = '#667eea';
    
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: ${bgColor};
        color: white;
        padding: 10px 20px;
        border-radius: 25px;
        font-size: 14px;
        z-index: 10000;
        animation: slideUp 0.3s ease;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        max-width: 90%;
        text-align: center;
        word-wrap: break-word;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom() {
    const container = document.querySelector('.messages-container');
    if (container) container.scrollTop = container.scrollHeight;
}

function isCameraSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

function isRecordingSupported() {
    return !!(window.MediaRecorder);
}

// В client.js, функция isSecureContext()
function isSecureContext() {
    // Для локальной разработки разрешаем HTTP
    return true;
}

function getSupportedMimeType() {
    const mimeTypes = [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp8',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp9',
        'video/webm',
        'video/mp4;codecs=h264',
        'video/mp4'
    ];
    
    for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
            return mimeType;
        }
    }
    return '';
}

function playVideo(videoUrl) {
    const modal = document.createElement('div');
    modal.className = 'video-player-modal';
    modal.innerHTML = `
        <div class="video-player-content">
            <video src="${videoUrl}" autoplay controls playsinline></video>
            <button class="close-player">✕</button>
        </div>
    `;
    document.body.appendChild(modal);
    
    modal.querySelector('.close-player').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

// ============ ОТОБРАЖЕНИЕ СООБЩЕНИЙ ============

function addMessageToUI(message, isNew = false) {
    if (pendingMessages.has(message.id)) {
        console.log('Дубликат сообщения, пропускаем:', message.id);
        return;
    }
    
    if (isNew) {
        pendingMessages.add(message.id);
        setTimeout(() => pendingMessages.delete(message.id), 1000);
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    messageDiv.setAttribute('data-message-id', message.id);
    
    const isOwn = message.from === currentUser?.username;
    
    if (isOwn) {
        messageDiv.classList.add('own');
    }
    
    const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const displayName = isOwn ? 'Вы' : message.from;
    const avatarLetter = isOwn ? currentUser?.username.charAt(0).toUpperCase() : message.from.charAt(0).toUpperCase();
    const avatarColor = isOwn ? currentUser?.color : message.color;
    
    if (message.type === 'video') {
        messageDiv.innerHTML = `
            <div class="user-avatar-circle small" style="background: ${avatarColor || '#667eea'}">
                ${avatarLetter}
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-username">${escapeHtml(displayName)}</span>
                    <span class="message-time">${time}</span>
                </div>
                <div class="video-message" data-url="${message.videoUrl}">
                    <video src="${message.videoUrl}" preload="metadata"></video>
                    <div class="play-overlay">▶️</div>
                    <div class="video-duration">${message.duration} сек</div>
                </div>
            </div>
        `;
        
        const videoDiv = messageDiv.querySelector('.video-message');
        if (videoDiv) {
            videoDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                playVideo(message.videoUrl);
            });
        }
    } else {
        messageDiv.innerHTML = `
            <div class="user-avatar-circle small" style="background: ${avatarColor || '#667eea'}">
                ${avatarLetter}
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-username">${escapeHtml(displayName)}</span>
                    <span class="message-time">${time}</span>
                </div>
                <div class="message-text">${escapeHtml(message.text)}</div>
            </div>
        `;
    }
    
    messagesContainer.appendChild(messageDiv);
    messageDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============ ОБНОВЛЕНИЕ СПИСКА ПОЛЬЗОВАТЕЛЕЙ ============

function updateUsersList(users) {
    const onlineUsers = users.filter(u => u.online);
    const onlineCountNum = onlineUsers.length;
    onlineCount.textContent = `${onlineCountNum} онлайн`;
    if (onlinePreviewCount) onlinePreviewCount.textContent = onlineCountNum;
    
    const sortedUsers = [...users].sort((a, b) => {
        if (a.online !== b.online) return b.online ? 1 : -1;
        return a.username.localeCompare(b.username);
    });
    
    usersList.innerHTML = sortedUsers.map(user => `
        <div class="user-item ${currentChatWith?.username === user.username ? 'active' : ''}" data-username="${user.username}">
            <div class="user-avatar-circle small" style="background: ${user.color || '#667eea'}">
                ${user.username.charAt(0).toUpperCase()}
            </div>
            <span class="user-name-small">${escapeHtml(user.username)}</span>
            <span class="online-status ${user.online ? 'online' : 'offline'}"></span>
            ${unreadCounts[user.username] > 0 ? `<span class="unread-badge">${unreadCounts[user.username]}</span>` : ''}
        </div>
    `).join('');
    
    document.querySelectorAll('.user-item').forEach(el => {
        el.addEventListener('click', () => {
            const username = el.dataset.username;
            const user = allUsers.find(u => u.username === username);
            if (user) {
                unreadCounts[user.username] = 0;
                selectUser(user);
                updateUsersList(allUsers);
            }
        });
    });
}

// ============ ВЫБОР ПОЛЬЗОВАТЕЛЯ ============

function selectUser(user) {
    if (currentChatWith?.username === user.username) return;
    
    currentChatWith = user;
    chatTitle.textContent = user.username;
    
    messagesContainer.innerHTML = '';
    pendingMessages.clear();
    
    socket.emit('messages:history', { withUser: user.username }, (response) => {
        if (response.success && response.messages) {
            console.log(`Загружено ${response.messages.length} сообщений с ${user.username}`);
            response.messages.forEach(msg => addMessageToUI(msg, false));
            scrollToBottom();
        }
    });
    
    if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
    }
}

function updateUnreadCount(message) {
    if (!currentChatWith || message.from !== currentChatWith.username) {
        if (message.from !== currentUser?.username) {
            unreadCounts[message.from] = (unreadCounts[message.from] || 0) + 1;
            updateUsersList(allUsers);
        }
    }
}

// ============ ВХОД ============

function restoreSession() {
    const savedUsername = localStorage.getItem('messenger_username');
    if (savedUsername) {
        usernameInput.value = savedUsername;
        setTimeout(() => loginBtn.click(), 500);
    }
}

loginBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) {
        showNotification('Введите ваше имя', 'error');
        return;
    }
    
    localStorage.setItem('messenger_username', username);
    
    socket.emit('user:login', username, (response) => {
        if (response.success) {
            currentUser = response.user;
            allUsers = response.allUsers.filter(u => u.username !== currentUser.username);
            
            loginScreen.style.display = 'none';
            chatApp.style.display = 'flex';
            
            currentUserDiv.innerHTML = `
                <div class="user-avatar-circle" style="background: ${currentUser.color}">
                    ${currentUser.username.charAt(0).toUpperCase()}
                </div>
                <span class="user-name">${escapeHtml(currentUser.username)}</span>
            `;
            
            updateUsersList(allUsers);
            showNotification(`Добро пожаловать, ${username}!`, 'success');
            
            setTimeout(() => {
                requestNotificationPermission();
                addNotificationButton();
            }, 1000);
        } else {
            showNotification('Ошибка входа: ' + response.error, 'error');
        }
    });
});

usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loginBtn.click();
});

// ============ ОТПРАВКА СООБЩЕНИЙ ============

function sendMessage() {
    if (!currentUser) {
        showNotification('Сначала войдите в чат', 'error');
        return;
    }
    
    if (!currentChatWith) {
        showNotification('Выберите пользователя для чата', 'error');
        return;
    }
    
    const text = messageInput.value.trim();
    if (!text) return;
    
    socket.emit('message:send', {
        to: currentChatWith.username,
        text: text,
        type: 'text'
    }, (response) => {
        if (response.success) {
            messageInput.value = '';
            messageInput.style.height = 'auto';
            addMessageToUI(response.message, true);
            scrollToBottom();
        } else {
            showNotification('Ошибка: ' + response.error, 'error');
        }
    });
}

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

messageInput.addEventListener('input', function() {
    if (!currentUser || !currentChatWith) return;
    
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    
    if (this.value.length > 0) {
        socket.emit('user:typing', { to: currentChatWith.username, isTyping: true });
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('user:typing', { to: currentChatWith.username, isTyping: false });
        }, 1000);
    } else {
        socket.emit('user:typing', { to: currentChatWith.username, isTyping: false });
    }
});

// ============ ВИДЕО ============

if (videoBtn) {
    videoBtn.addEventListener('click', async () => {
        if (!currentUser) {
            showNotification('Сначала войдите в чат', 'error');
            return;
        }
        
        if (!currentChatWith) {
            showNotification('Выберите пользователя для чата', 'error');
            return;
        }
        
        if (!isRecordingSupported() || !isCameraSupported()) {
            showNotification('Ваш браузер не поддерживает запись видео', 'error');
            return;
        }
        
        if (!isSecureContext()) {
            showNotification('Для записи видео нужен HTTPS', 'error');
            return;
        }
        
        try {
            showNotification('Запрос доступа к камере...', 'info');
            
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 320 }, height: { ideal: 320 }, frameRate: { ideal: 15 } },
                audio: true
            });
            
            currentStream = stream;
            videoPreview.srcObject = stream;
            videoPreview.setAttribute('playsinline', 'true');
            videoPreview.muted = true;
            videoPreview.play();
            
            const devices = await navigator.mediaDevices.enumerateDevices();
            availableCameras = devices.filter(d => d.kind === 'videoinput');
            
            if (availableCameras.length > 1 && switchCameraBtn) {
                switchCameraBtn.style.display = 'flex';
            }
            
            videoModal.classList.add('active');
            resetVideoRecording();
            showNotification('Камера готова! Максимум 10 секунд', 'success');
            
        } catch (err) {
            showNotification(`Ошибка: ${err.message}`, 'error');
        }
    });
}

if (switchCameraBtn) {
    switchCameraBtn.addEventListener('click', async () => {
        if (availableCameras.length <= 1) {
            showNotification('Только одна камера', 'info');
            return;
        }
        
        let currentIndex = availableCameras.findIndex(cam => cam.deviceId === currentCameraDeviceId);
        if (currentIndex === -1) currentIndex = 0;
        
        const nextIndex = (currentIndex + 1) % availableCameras.length;
        const nextCamera = availableCameras[nextIndex];
        
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
        }
        
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: nextCamera.deviceId }, width: { ideal: 320 }, height: { ideal: 320 } },
                audio: true
            });
            
            currentStream = newStream;
            videoPreview.srcObject = newStream;
            currentCameraDeviceId = nextCamera.deviceId;
            showNotification('Камера переключена', 'success');
            resetVideoRecording();
        } catch (err) {
            showNotification('Не удалось переключить камеру', 'error');
        }
    });
}

function resetVideoRecording() {
    recordedChunks = [];
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    startRecordBtn.style.display = 'flex';
    stopRecordBtn.style.display = 'none';
    sendVideoBtn.style.display = 'none';
    cancelVideoBtn.style.display = 'none';
    recordTimer.textContent = '0:00';
    if (progressBar) progressBar.style.width = '0%';
    if (recordTimerInterval) clearInterval(recordTimerInterval);
}

if (startRecordBtn) {
    startRecordBtn.addEventListener('click', () => {
        if (!currentStream) {
            showNotification('Нет доступа к камере', 'error');
            return;
        }
        
        recordedChunks = [];
        const mimeType = getSupportedMimeType();
        
        try {
            mediaRecorder = new MediaRecorder(currentStream, mimeType ? { mimeType } : {});
        } catch (err) {
            mediaRecorder = new MediaRecorder(currentStream);
        }
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            if (recordedChunks.length === 0) {
                showNotification('Не удалось записать видео', 'error');
                return;
            }
            
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            
            if (blob.size < 5000) {
                showNotification('Видео слишком маленькое', 'error');
                return;
            }
            
            if (blob.size > 5 * 1024 * 1024) {
                showNotification('Видео слишком большое, попробуйте короче', 'error');
                return;
            }
            
            showNotification('Обработка видео...', 'info');
            
            const url = URL.createObjectURL(blob);
            if (videoPreview.srcObject) videoPreview.srcObject = null;
            videoPreview.src = url;
            videoPreview.load();
            videoPreview.play();
            
            sendVideoBtn.style.display = 'flex';
            cancelVideoBtn.style.display = 'flex';
            startRecordBtn.style.display = 'none';
            stopRecordBtn.style.display = 'none';
            if (switchCameraBtn) switchCameraBtn.style.display = 'none';
            
            sendVideoBtn.onclick = () => sendVideo(blob);
        };
        
        mediaRecorder.start(1000);
        recordStartTime = Date.now();
        startRecordBtn.style.display = 'none';
        stopRecordBtn.style.display = 'flex';
        if (switchCameraBtn) switchCameraBtn.style.display = 'none';
        
        let seconds = 0;
        recordTimerInterval = setInterval(() => {
            seconds++;
            recordTimer.textContent = `0:${seconds.toString().padStart(2, '0')}`;
            const percent = (seconds / 10) * 100;
            progressBar.style.width = Math.min(percent, 100) + '%';
            
            if (seconds >= 10) {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                }
                clearInterval(recordTimerInterval);
                showNotification('Запись завершена', 'info');
            }
        }, 1000);
    });
}

if (stopRecordBtn) {
    stopRecordBtn.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
        clearInterval(recordTimerInterval);
        showNotification('Запись остановлена', 'info');
    });
}

if (cancelVideoBtn) {
    cancelVideoBtn.addEventListener('click', () => {
        if (currentStream) {
            videoPreview.srcObject = currentStream;
            videoPreview.src = '';
        }
        resetVideoRecording();
        if (availableCameras.length > 1 && switchCameraBtn) {
            switchCameraBtn.style.display = 'flex';
        }
        showNotification('Запись отменена', 'info');
    });
}

async function sendVideo(blob) {
    if (!currentUser || !currentChatWith) {
        showNotification('Сначала войдите в чат и выберите пользователя', 'error');
        closeVideoModal();
        return;
    }
    
    if (!socket.connected) {
        showNotification('Нет соединения с сервером', 'error');
        return;
    }
    
    const sizeMB = blob.size / 1024 / 1024;
    showNotification(`📤 Отправка (${sizeMB.toFixed(1)} MB)...`, 'info');
    
    const reader = new FileReader();
    
    reader.onload = () => {
        socket.emit('video:send', {
            to: currentChatWith.username,
            video: reader.result,
            duration: Math.min(Math.floor(blob.size / 100000) + 1, 10)
        }, (response) => {
            if (response && response.success) {
                addMessageToUI(response.message, true);
                scrollToBottom();
                closeVideoModal();
                showNotification('✅ Видео отправлено!', 'success');
            } else {
                showNotification(`Ошибка: ${response?.error || 'Неизвестная ошибка'}`, 'error');
            }
        });
    };
    
    reader.onerror = () => {
        showNotification('Ошибка чтения видео', 'error');
    };
    
    reader.readAsDataURL(blob);
}

function closeVideoModal() {
    videoModal.classList.remove('active');
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }
    if (recordTimerInterval) clearInterval(recordTimerInterval);
    if (videoPreview) {
        if (videoPreview.srcObject) videoPreview.srcObject = null;
        videoPreview.src = '';
    }
    resetVideoRecording();
}

closeModal.addEventListener('click', closeVideoModal);
videoModal.addEventListener('click', (e) => {
    if (e.target === videoModal) closeVideoModal();
});

// ============ ПОЛУЧЕНИЕ НОВЫХ СООБЩЕНИЙ ============

socket.on('message:new', (message) => {
    console.log('Получено новое сообщение:', message);
    
    if (message.from === currentUser?.username) {
        console.log('Своё сообщение, пропускаем (уже показано)');
        return;
    }
    
    notifyNewMessage(message);
    
    const isForCurrentChat = currentChatWith && message.from === currentChatWith.username;
    
    if (isForCurrentChat) {
        addMessageToUI(message, true);
        scrollToBottom();
    } else {
        updateUnreadCount(message);
    }
    
    if (document.hidden && message.from !== currentUser?.username) {
        const notificationText = message.type === 'video' ? '📹 Видео' : message.text;
        document.title = `📩 ${message.from}: ${notificationText}`;
        setTimeout(() => document.title = 'Team Messenger', 3000);
        playNotificationSound();
    }
});

// ============ ИНДИКАТОР ПЕЧАТИ ============

socket.on('user:typing', ({ from, isTyping }) => {
    if (currentChatWith && from === currentChatWith.username) {
        if (isTyping) {
            typingIndicator.textContent = `${from} печатает...`;
        } else {
            typingIndicator.textContent = '';
        }
    }
});

// ============ ОНЛАЙН ПОЛЬЗОВАТЕЛИ ============

socket.on('users:list', (onlineUsers) => {
    console.log('Обновление списка онлайн:', onlineUsers.map(u => u.username));
    
    allUsers = allUsers.map(user => ({
        ...user,
        online: onlineUsers.some(u => u.username === user.username)
    }));
    
    for (const onlineUser of onlineUsers) {
        if (!allUsers.some(u => u.username === onlineUser.username)) {
            allUsers.push({
                id: onlineUser.id,
                username: onlineUser.username,
                online: true,
                color: onlineUser.color
            });
        }
    }
    
    updateUsersList(allUsers);
});

// ============ ВОССТАНОВЛЕНИЕ СОЕДИНЕНИЯ ============

socket.on('connect', () => {
    console.log('Соединение восстановлено');
    if (currentUser) {
        socket.emit('user:check', (response) => {
            if (response.success) {
                currentUser = response.user;
                allUsers = response.allUsers.filter(u => u.username !== currentUser.username);
                updateUsersList(allUsers);
                if (currentChatWith) {
                    selectUser(currentChatWith);
                }
            } else {
                localStorage.removeItem('messenger_username');
                location.reload();
            }
        });
    } else {
        restoreSession();
    }
});

socket.on('disconnect', () => {
    console.log('Соединение потеряно');
    showNotification('Потеря связи, переподключение...', 'info');
});

// ============ МОБИЛЬНОЕ МЕНЮ ============

if (menuToggle) {
    menuToggle.addEventListener('click', () => sidebar.classList.add('open'));
}
if (closeSidebar) {
    closeSidebar.addEventListener('click', () => sidebar.classList.remove('open'));
}
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar && !sidebar.contains(e.target) && !menuToggle?.contains(e.target)) {
        sidebar.classList.remove('open');
    }
});

// ============ СТАТИСТИКА ============

async function loadStorageStats() {
    try {
        const response = await fetch('/api/stats');
        const stats = await response.json();
        const storageInfo = document.getElementById('storageInfo');
        if (storageInfo && stats.videos) {
            storageInfo.innerHTML = `📹 ${stats.videos.count} видео | 💾 ${stats.videos.sizeMB} MB | 💬 ${stats.totalMessages} сообщений`;
        }
    } catch (e) {
        console.log('Не удалось загрузить статистику');
    }
}

setInterval(loadStorageStats, 30000);
setTimeout(loadStorageStats, 2000);

restoreSession();
console.log('✅ Client.js загружен');