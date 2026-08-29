# ==============================================================================
# AIDEOS STUDIO & VIDEO COMPILER — GOOGLE CLOUD RUN DOCKERFILE
# ==============================================================================
# Containerizes the Aideos Vite Studio Editor, Google GenAI agent compiler,
# and Remotion video rendering pipeline with pre-installed Chromium and FFmpeg.
# ==============================================================================

FROM node:20-bookworm-slim

# 1. Install system dependencies: Chromium, FFmpeg, and Asian/Emoji/Western fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-freefont-ttf \
    fonts-noto-color-emoji \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    REMOTION_CHROME_BIN=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=8080

WORKDIR /app

# 2. Install backend and root dependencies
COPY package*.json ./
RUN npm ci --include=dev

# 3. Copy project source code
COPY . .

# 4. Build Vite frontend bundle
RUN cd editor && npm ci && npm run build

# 5. Expose Cloud Run default port
EXPOSE 8080

# 6. Start server with host 0.0.0.0 and port 8080
CMD ["npm", "run", "editor", "--", "--host", "0.0.0.0", "--port", "8080"]
