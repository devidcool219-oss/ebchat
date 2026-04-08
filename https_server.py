#!/usr/bin/env python3
import http.server
import socketserver
import ssl
import os
import mimetypes

PORT = 4443
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    
    def end_headers(self):
        # Добавляем заголовки для безопасности
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()
    
    def guess_type(self, path):
        """Правильно определяем MIME-типы"""
        if path.endswith('.webm'):
            return 'video/webm'
        elif path.endswith('.js'):
            return 'application/javascript'
        elif path.endswith('.css'):
            return 'text/css'
        elif path.endswith('.html'):
            return 'text/html'
        return super().guess_type(path)

def run_server():
    handler = CustomHTTPRequestHandler
    
    # Создаем сервер на всех интерфейсах (чтобы телефон мог подключиться)
    httpd = socketserver.TCPServer(("0.0.0.0", PORT), handler)
    
    # Настраиваем SSL
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_context.load_cert_chain('cert.pem', 'key.pem')
    httpd.socket = ssl_context.wrap_socket(httpd.socket, server_side=True)
    
    print(f"\n{'='*50}")
    print(f"🚀 HTTPS СЕРВЕР ЗАПУЩЕН!")
    print(f"{'='*50}")
    print(f"📱 На телефоне откройте:")
    print(f"   https://[IP_вашего_компьютера]:{PORT}")
    print(f"")
    print(f"⚠️  Браузер покажет предупреждение - нажмите 'Продолжить'")
    print(f"🔧 Для остановки сервера нажмите Ctrl+C")
    print(f"{'='*50}\n")
    
    # Выводим IP адрес компьютера
    import socket
    hostname = socket.gethostname()
    local_ip = socket.gethostbyname(hostname)
    print(f"💻 IP адрес компьютера в локальной сети: {local_ip}")
    print(f"📱 Полный адрес для телефона: https://{local_ip}:{PORT}\n")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Сервер остановлен")
        httpd.shutdown()

if __name__ == "__main__":
    run_server()