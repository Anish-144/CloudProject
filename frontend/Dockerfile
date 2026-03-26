FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# We use the Vite dev server for easy development running from docker-compose
EXPOSE 80
ENV PORT=80

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "80"]
