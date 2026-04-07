FROM node:18-bullseye

WORKDIR /app

# 1. Copy package files first for better caching
COPY package.json package-lock.json ./

# 2. Clean cache and perform a clean install (deterministic)
RUN npm cache clean --force
RUN npm ci --legacy-peer-deps

# 3. Copy the rest of the source code
COPY . .

# 4. Expose port 80 (standard for our dev setup)
EXPOSE 80
ENV PORT=80

# 5. Run Vite dev server in host-exposed mode
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "80"]
