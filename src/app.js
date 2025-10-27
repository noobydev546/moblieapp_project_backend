const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { readdirSync } = require('fs')

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

readdirSync('src/routes')
    .map((c) => app.use('/api', require('./routes/' + c)))

module.exports = app;