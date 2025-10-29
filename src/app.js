const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { readdirSync } = require('fs')

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

const systemRoutes = require('./routes/system.js');
const authRoutes = require('./routes/auth.js');

app.use('/api/auth', authRoutes);
app.use('/api', systemRoutes);

module.exports = app;