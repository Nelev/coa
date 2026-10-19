FROM node:24-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# NEXT_PUBLIC_* values are written into the browser bundle when it is built, so they are build arguments
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/auth/callback
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_WORKOS_REDIRECT_URI=$NEXT_PUBLIC_WORKOS_REDIRECT_URI
RUN npm run build && npm prune --omit=dev

FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.mjs ./

EXPOSE 3000
# no --hostname: with it Next takes 0.0.0.0 as the address of the server and AuthKit sends people to http://0.0.0.0:3000 once signed in; without it
# the server still listens on every interface, so the published port works, and its own address is localhost
CMD ["node_modules/.bin/next", "start"]
