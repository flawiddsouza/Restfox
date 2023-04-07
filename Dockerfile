FROM node:19.8.1-alpine3.17
RUN mkdir /app
ADD ./packages/web-standalone /app/web-standalone/
WORKDIR /app/web-standalone
RUN npm install
CMD ["npm", "start"]
