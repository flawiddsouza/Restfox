# Stage 1: Build the UI and web-standalone
FROM node:19.8.1-alpine3.17 AS build
RUN mkdir /app
ADD ./packages/ui /app/ui/
ADD ./packages/web-standalone /app/web-standalone/
WORKDIR /app/ui
RUN npm ci && npm run build-web-standalone
WORKDIR /app/web-standalone
RUN npm ci

# Stage 2: Copy the necessary files from the build stage and remove unnecessary files
FROM node:19.8.1-alpine3.17
RUN mkdir -p /app/web-standalone/public
WORKDIR /app/web-standalone
COPY --from=build /app/web-standalone /app/web-standalone
COPY --from=build /app/ui/dist /app/web-standalone/public
CMD ["npm", "start"]
