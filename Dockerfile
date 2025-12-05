FROM ghcr.io/puppeteer/puppeteer:21.5.0

WORKDIR /usr/src/app

COPY package*.json ./

# Пропускаємо завантаження хрома, бо він вже є в образі
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm ci

COPY . .

CMD [ "node", "index.js" ]
