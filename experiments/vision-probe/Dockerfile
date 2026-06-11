# ==========================================
# Stage 1: Get official llama-server binary
# ==========================================
FROM ghcr.io/ggml-org/llama.cpp:server AS llama-bin

# ==========================================
# Stage 2: Main application runtime
# ==========================================
FROM node:26-slim

# Copy llama-server from Stage 1 into system path
COPY --from=llama-bin /app/llama-server /usr/local/bin/llama-server

# Set working directory inside the container
WORKDIR /app

# Copy package configurations
COPY package*.json ./

# Install npm dependencies (including tsx and typescript for running src files)
RUN npm ci

# Copy the rest of the application files
COPY . .

# Expose ports:
# 8080: main llama-server port
# 8081: embedding server port (if spawned)
EXPOSE 8080 8081

# Default environment variables
ENV VISION_PROBE_MODEL_BASE_URL="https://lokalmind-models.sandipan-lokalmind.workers.dev"
ENV VISION_PROBE_DATA_DIR="/app/.data"

# The command is kept flexible. Users can override it to run wizard, chat, or probe.
CMD ["npm", "run", "wizard"]
