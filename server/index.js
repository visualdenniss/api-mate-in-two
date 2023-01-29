const express = require('express')
const app = express()
const cors = require('cors')
require('dotenv').config()
app.use(cors())
app.use(express.json())

const {getPuzzle} = require('./getPuzzle')

// routes 

app.get('/',getPuzzle)

const port = process.env.PORT || 5000

app.listen(port,console.log('Server is listening on port 5000...'))