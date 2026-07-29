FROM node:22-alpine

WORKDIR /app

# Katman cache'i: önce SADECE package*.json'ı kopyala ve bağımlılıkları kur.
# Böylece kod değişse de (bağımlılıklar değişmedikçe) npm ci adımı cache'ten gelir.
COPY package.json package-lock.json ./
RUN npm ci

# Uygulama kodunu bağımlılıklardan SONRA kopyala.
COPY . .

EXPOSE 5173
