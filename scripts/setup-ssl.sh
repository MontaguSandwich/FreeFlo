#!/bin/bash
# ============================================
# SSL Setup with Let's Encrypt
# ============================================
# Run this after deploy-vps.sh to add HTTPS

set -e

echo "🔐 SSL Setup with Let's Encrypt"
echo "================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "⚠️  Please run as root or with sudo"
    exit 1
fi

# Get domain
read -p "Enter your domain (e.g., api.zkp2p.xyz): " DOMAIN

if [ -z "$DOMAIN" ]; then
    echo "❌ Domain is required"
    exit 1
fi

# Get email
read -p "Enter your email for Let's Encrypt notifications: " EMAIL

if [ -z "$EMAIL" ]; then
    echo "❌ Email is required"
    exit 1
fi

# ============================================
# Install Certbot
# ============================================
echo ""
echo "📦 Installing Certbot..."

apt-get update
apt-get install -y certbot

# ============================================
# Stop nginx temporarily
# ============================================
echo ""
echo "⏸️  Stopping nginx..."

docker compose stop nginx 2>/dev/null || true

# ============================================
# Get certificate
# ============================================
echo ""
echo "🔒 Obtaining SSL certificate..."

certbot certonly --standalone \
    -d "$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos \
    --non-interactive

# ============================================
# Copy certificates
# ============================================
echo ""
echo "📋 Copying certificates..."

APP_DIR="/opt/zkp2p-offramp"
mkdir -p "$APP_DIR/nginx/ssl"

cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$APP_DIR/nginx/ssl/"
cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$APP_DIR/nginx/ssl/"

# ============================================
# Update nginx config
# ============================================
echo ""
echo "⚙️  Updating nginx configuration..."

cat > "$APP_DIR/nginx/nginx.conf" << 'NGINX_CONFIG'
events {
    worker_connections 1024;
}

http {
    # Logging
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=quote:10m rate=30r/m;

    # Upstream services
    upstream solver_health {
        server solver:8080;
    }

    upstream solver_api {
        server solver:8081;
    }

    # HTTP -> HTTPS redirect
    server {
        listen 80;
        server_name DOMAIN_PLACEHOLDER;
        return 301 https://$server_name$request_uri;
    }

    # HTTPS server
    server {
        listen 443 ssl http2;
        server_name DOMAIN_PLACEHOLDER;

        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;
        
        # SSL settings
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_prefer_server_ciphers on;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;

        # Health check
        location /health {
            proxy_pass http://solver_health/health;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # Quote API
        location /api/quote {
            limit_req zone=quote burst=5 nodelay;

            add_header 'Access-Control-Allow-Origin' '*' always;
            add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type' always;

            if ($request_method = 'OPTIONS') {
                add_header 'Access-Control-Allow-Origin' '*';
                add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS';
                add_header 'Access-Control-Allow-Headers' 'Content-Type';
                add_header 'Access-Control-Max-Age' 1728000;
                add_header 'Content-Type' 'text/plain; charset=utf-8';
                add_header 'Content-Length' 0;
                return 204;
            }

            proxy_pass http://solver_api/api/quote;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Supported
        location /api/supported {
            limit_req zone=api burst=10 nodelay;
            add_header 'Access-Control-Allow-Origin' '*' always;
            proxy_pass http://solver_api/api/supported;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # Stats
        location /stats {
            proxy_pass http://solver_health/stats;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # Default
        location / {
            return 404 '{"error": "Not found"}';
            add_header Content-Type application/json;
        }
    }
}
NGINX_CONFIG

# Replace domain placeholder
sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" "$APP_DIR/nginx/nginx.conf"

# ============================================
# Restart nginx
# ============================================
echo ""
echo "🔄 Restarting nginx..."

cd "$APP_DIR"
docker compose up -d nginx

# ============================================
# Setup auto-renewal
# ============================================
echo ""
echo "⏰ Setting up auto-renewal..."

cat > /etc/cron.d/certbot-renewal << CRON
0 0 1 * * root certbot renew --quiet && cp /etc/letsencrypt/live/$DOMAIN/*.pem $APP_DIR/nginx/ssl/ && docker compose -f $APP_DIR/docker-compose.yml restart nginx
CRON

# ============================================
# Done!
# ============================================
echo ""
echo "============================================"
echo "🎉 SSL Setup Complete!"
echo "============================================"
echo ""
echo "Your API is now available at:"
echo "  https://$DOMAIN/api/quote?amount=10&currency=EUR"
echo ""
echo "Update your Vercel frontend:"
echo "  NEXT_PUBLIC_SOLVER_API_URL=https://$DOMAIN"
echo ""

