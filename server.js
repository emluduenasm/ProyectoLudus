// server.js
import { createServer } from "http";
import app from "./src/app.js";
import adminDesignsRoutes from "./src/routes/adminDesignsRoutes.js";

app.use("/api/admin/designs", adminDesignsRoutes);

const port = process.env.PORT || 3000;
const server = createServer(app);

server.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
