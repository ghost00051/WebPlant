# Шлюз наружу для стека в Kubernetes.
#
# Docker Desktop Kubernetes не пробрасывает NodePort/LoadBalancer на хост, поэтому
# deploy.ps1 поднимает этот контейнер в docker-сети kind с публикацией порта 8090:
#
#   Windows/хост      → http://localhost:8090
#   compose-стек      → http://ctp_k8s_gateway:8090  (контейнер подключён и к backend_ctp_network)
#   внутри кластера   → Service backend:5000
#
# Апстримы — NodePort 30080 на всех нодах кластера: nginx сам исключает упавшие ноды.
# Ноды задаются именами контейнеров (docker DNS сети kind), а не IP: при пересоздании
# кластера адреса меняются, а имена остаются.
# Список нод подставляет scripts/deploy.ps1 (единственный плейсхолдер — ниже, в upstream).

worker_processes 1;

events {
    worker_connections 1024;
}

stream {
    upstream webplant_backend {
        least_conn;
__UPSTREAM_SERVERS__
    }

    server {
        listen 8090;
        proxy_pass webplant_backend;
        proxy_connect_timeout 3s;
        proxy_timeout 300s;
    }
}
