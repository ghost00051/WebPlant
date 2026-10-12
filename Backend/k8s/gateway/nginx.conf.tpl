
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
