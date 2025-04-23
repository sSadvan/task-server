const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

const port = process.env.PORT || 3000;

app.post("/task", async (req, res) => {
  const { text, delay } = req.body;

  if (!text || !delay) {
    return res.status(400).send("Missing 'text' or 'delay'");
  }

  console.log(`Задача получена: "${text}", отправка через ${delay / 1000} секунд`);

  setTimeout(() => {
    fetch("https://hook.eu2.make.com/gfv7c32jl73ifs79pyg0y8tqsj1xprpk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    }).then(() => {
      console.log("Сообщение отправлено в Telegram через Make");
    }).catch(err => {
      console.error("Ошибка при отправке:", err);
    });
  }, delay);

  res.send("Задача получена и поставлена в очередь.");
});

app.listen(port, () => {
  console.log(`Сервер слушает на порту ${port}`);
});
