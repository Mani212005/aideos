# ==============================================================================
# AIDEOS STUDIO & VIDEO COMPILER - GOOGLE CLOUD RUN DOCKERFILE
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

# 2. Copy project source code and install root and editor dependencies (the root postinstall
#    installs editor/ too, so this needs the source present first)
COPY . .
RUN npm ci --include=dev

# 3. Expose the service port
EXPOSE 8080

# 4. Start the studio server. The API lives in the editor dev server's middleware, so that is what
#    runs here; exec vite directly rather than through npm, which adds two npm processes (~60 MB)
#    on a 512 MB instance.
WORKDIR /app/editor
CMD ["./node_modules/.bin/vite", "--host", "0.0.0.0"]
