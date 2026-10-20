# Electronic Invoice UI

React and Vite frontend for the Electronic Invoice workspace. The app provides role-aware views for administrators and level 1/2 approvers.

## Local development

Start the Spring Boot API on `http://localhost:8080`, then run:

```sh
npm install
npm run dev
```

Open `http://localhost:5173`. Set `VITE_API_URL` if the API uses a different URL. The default points to `http://localhost:8080/api`.

## Production container

The included Dockerfile builds the Vite app and serves it through Nginx. Nginx forwards `/api/` requests to the `backend` service, so the browser uses the same origin for the UI and API.
