# ==============================================================
# Agent Arena: Combined Backend + AXL P2P Mesh
# Deploys as a single Railway service
# ==============================================================

# Stage 1: Build AXL binary (Go)
FROM golang:1.25-alpine AS axl-builder
WORKDIR /axl
COPY axl/go.mod axl/go.sum ./
RUN go mod download
COPY axl/ .
RUN go build -o node ./cmd/node/

# Stage 2: Build backend (Bun)
FROM oven/bun:1 AS backend-builder
WORKDIR /app
COPY backend/package.json backend/bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY backend/ .
RUN bunx prisma generate --config prisma/prisma.config.ts

# Stage 3: Runtime
FROM oven/bun:1

RUN apt-get update -y && apt-get install -y \
    openssl \
    python3 \
    python3-pip \
    procps \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install MCP router dependency
RUN pip3 install --break-system-packages aiohttp

WORKDIR /app

# Copy AXL binary
COPY --from=axl-builder /axl/node /app/axl/node
RUN chmod +x /app/axl/node

# Copy AXL integrations (MCP router + A2A server)
COPY axl/integrations/ /app/axl/integrations/

# Generate AXL identity keys
RUN openssl genpkey -algorithm ed25519 -out /app/axl/hub.pem && \
    openssl genpkey -algorithm ed25519 -out /app/axl/mirror.pem && \
    openssl genpkey -algorithm ed25519 -out /app/axl/scorpion.pem && \
    openssl genpkey -algorithm ed25519 -out /app/axl/viper.pem && \
    openssl genpkey -algorithm ed25519 -out /app/axl/dove.pem && \
    openssl genpkey -algorithm ed25519 -out /app/axl/phoenix.pem

# Create AXL node configs
RUN echo '{"PrivateKeyPath":"/app/axl/hub.pem","Peers":[],"Listen":["tls://0.0.0.0:9001"],"api_port":9002,"tcp_port":7000,"router_addr":"http://127.0.0.1","router_port":9003,"a2a_addr":"http://127.0.0.1","a2a_port":9004}' > /app/axl/hub-config.json && \
    echo '{"PrivateKeyPath":"/app/axl/mirror.pem","Peers":["tls://127.0.0.1:9001"],"Listen":[],"api_port":9012,"tcp_port":7001}' > /app/axl/mirror-config.json && \
    echo '{"PrivateKeyPath":"/app/axl/scorpion.pem","Peers":["tls://127.0.0.1:9001"],"Listen":[],"api_port":9022,"tcp_port":7002}' > /app/axl/scorpion-config.json && \
    echo '{"PrivateKeyPath":"/app/axl/viper.pem","Peers":["tls://127.0.0.1:9001"],"Listen":[],"api_port":9032,"tcp_port":7003}' > /app/axl/viper-config.json && \
    echo '{"PrivateKeyPath":"/app/axl/dove.pem","Peers":["tls://127.0.0.1:9001"],"Listen":[],"api_port":9042,"tcp_port":7004}' > /app/axl/dove-config.json && \
    echo '{"PrivateKeyPath":"/app/axl/phoenix.pem","Peers":["tls://127.0.0.1:9001"],"Listen":[],"api_port":9052,"tcp_port":7005}' > /app/axl/phoenix-config.json

# Copy backend
COPY --from=backend-builder /app /app/backend
WORKDIR /app/backend

# Create startup script
RUN cat <<'EOF' > /app/start.sh
#!/bin/bash
set -e

echo "[Deploy] Starting AXL P2P mesh..."
cd /app/axl
./node -config hub-config.json &
sleep 1
./node -config mirror-config.json &
./node -config scorpion-config.json &
./node -config viper-config.json &
./node -config dove-config.json &
./node -config phoenix-config.json &
sleep 2

echo "[Deploy] Starting MCP Router..."
cd /app/axl/integrations
python3 -m mcp_routing.mcp_router --port 9003 &
sleep 1

echo "[Deploy] Starting backend..."
cd /app/backend
exec bun index.ts
EOF
RUN chmod +x /app/start.sh

EXPOSE ${PORT:-3700}

CMD ["/app/start.sh"]
