FROM node:19.8.1-alpine3.17
RUN mkdir /app
ADD ./packages/web-standalone /app/web-standalone/
CMD ["sh","-c","cd /app/web-standalone;npm start"]
