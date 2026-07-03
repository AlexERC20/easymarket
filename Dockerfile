FROM node:22-alpine

WORKDIR /app

# Fonts for server-side Story image rendering (sharp/librsvg needs Cyrillic + ★ glyphs).
RUN apk add --no-cache fontconfig ttf-dejavu

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
