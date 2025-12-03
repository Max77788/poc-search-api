FROM ghcr.io/puppeteer/puppeteer:21.0.0

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

EXPOSE 8080

CMD ["node", "server.js"]
