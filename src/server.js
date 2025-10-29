const dotenv = require('dotenv');
const app = require('./app');
dotenv.config();

const port = process.env.PORT || 3000;
app.listen(port,'0.0.0.0', () => {
  console.log(`Server is running on port :${port}`);
});
