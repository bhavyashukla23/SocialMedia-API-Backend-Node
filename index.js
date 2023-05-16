const express = require('express');
const mysql = require('mysql2/promise');
require('dotenv').config();
const ImageKit = require('imagekit');
const multer = require('multer');
const upload = multer();
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// MySQL connection pool
const pool = mysql.createPool({
  host: process.env.HOST,
  user: process.env.USER,
  password: process.env.PASSWORD,
  database: process.env.DATABASE
});

// Sign up route
app.post('/signup', upload.single('image'), async (req, res) => {
  try {
    const file = req.file;
    let imagekit = new ImageKit({
      publicKey: "public_dSRYaypLefJnm1MGoOCTpz82hYY=",
      privateKey: "private_8IjqJmUn+zK31JVxLhK3f9kpHJs=",
      urlEndpoint: "https://ik.imagekit.io/xbhl72nu6"
    });

    const uploadResponse = await imagekit.upload({
      file: file.buffer,
      fileName: req.body.fileName,
    });

    const image = uploadResponse.url;
    const { name, email, pnumber, username, password } = req.body;
    const conn = await pool.getConnection();
    const result = await conn.query('INSERT INTO users (name, email, pnumber, username, password, image) VALUES (?, ?, ?, ?, ?, ?)', [name, email, pnumber, username, password, image]);
    conn.release();

    res.status(201).send('User created successfully!');
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'User creation failed' });
  }
});

//  Login route
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const conn = await pool.getConnection();
    const results = await conn.query('SELECT * FROM users WHERE email = ?', [email]);
    console.log(results);
    if (results.length === 0) {
      return res.status(401).send('Invalid email or password');
    } else {
      const user = results[0][0];
      console.log(user);
      if (user.password === password) {
        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
        await conn.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
        return res.status(200).json({ token })
      } else {
        return res.status(401).send('Invalid email or password');
      }
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: 0, message: "Database connection error" })
  }
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Route to post a new message
app.post('/messages', authenticateToken, async (req, res) => {
  const { content } = req.body;
  const userId = req.user.id;
  const conn = await pool.getConnection();
  const results = await conn.query('INSERT INTO messages (content, user_id) VALUES (?, ?)', [content, userId]);
  try {
    res.status(201).send('Message posted successfully');
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal server error');
  }
});

// Route to like a message
app.post('/messages/likes', authenticateToken, async (req, res) => {
  const {messageId} = req.body;
  const userId = req.user.id;
  const conn = await pool.getConnection();
  const results = await conn.query('INSERT INTO likes (message_id, user_id) VALUES (?, ?)', [messageId, userId]);
  try {
    res.status(201).send('Message liked successfully');
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal server error');
  }
});    

//  API endpoint for fetching user details
app.get('/getusers', async (req, res) => {
  const username = req.query.username;
  const conn = await pool.getConnection();
  const result = await conn.query('SELECT * FROM users WHERE username = ?', [username]);
  try {
    if (result.length === 0) {
      res.status(404).send('User not found');
      return;
    }
    else {
      res.json(result[0][0]);
    }
  } catch (error) {
    console.error('Error querying MySQL: ' + error.stack);
    res.status(500).send('Internal server error');
    return;
  }
});

// Retrieve the number of total users
app.get('/total-users',async (req, res) => {
  const conn = await pool.getConnection();
  const results = await conn.query('SELECT COUNT(*) AS total_users FROM users');
 try{
  res.json(results[0][0]);
 }catch(error){
  console.error('Error executing query:', err);
      res.status(500).json({ error: 'Failed to retrieve the number of total users.' });
      return;
 }
});

// Retrieve the number of users signed up last week
app.get('/users-signed-up-last-week', async(req, res) => {
  const conn = await pool.getConnection();
  const results = await conn.query(`SELECT COUNT(*) AS new_users FROM users WHERE signup_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK)`);
  try{
    res.json(results[0][0]);
  }catch(error){
    console.error('Error executing query:', err);
      res.status(500).json({ error: 'Failed to retrieve the number of users signed up last week.' });
      return;
  }
});

//  Retrieve the number of users who have not logged in after signup
app.get('/users-not-logged-in-after-signup',async (req, res) => {
  const conn = await pool.getConnection();
  const results = await conn.query(`SELECT COUNT(*) AS users_not_logged_in FROM users WHERE last_login IS NULL`);
  try{
    res.json(results[0][0]);
  }catch(error){
    console.error('Error executing query:', err);
    res.status(500).json({ error: 'Failed to retrieve the number of users not logged in after signup.' });
    return;
  }
});

// Retrieve the number of users not logged in last week
app.get('/users-not-logged-in-last-week',async (req, res) => {
  const conn = await pool.getConnection();
  const results = await conn.query(`SELECT COUNT(*) AS users_not_logged_in FROM users WHERE last_login < DATE_SUB(NOW(), INTERVAL 1 WEEK)`);
 try{
  res.json(results[0][0]);
 }catch(error){
  console.error('Error executing query:', err);
      res.status(500).json({ error: 'Failed to retrieve the number of users not logged in last week.' });
      return;
 }
});

//  Retrieve the user who posted the most
app.get('/user-posted-most',async (req, res) => {
  const conn = await pool.getConnection();
  const results = await conn.query(`SELECT user_id, COUNT(*) AS count FROM messages GROUP BY user_id ORDER BY count DESC LIMIT 1`);
    try{
      if (results.length === 0) {
        res.status(404).json({ error: 'No users found.' });
        return;
      }
      res.json(results[0]);
    }catch(error){
      console.error('Error executing query:', err);
      res.status(500).json({ error: 'Failed to retrieve the user who posted the most.' });
      return;
    }
});

// Retrieve user who posted the most on a particular date
app.get('/most-posts-on-date',async (req, res) => {
  const date = req.query.date;
  const conn = await pool.getConnection();
  const results = await conn.query(`SELECT user_id, COUNT(*) AS count FROM messages WHERE DATE(message_date_time) = '${date}' GROUP BY user_id ORDER BY count DESC LIMIT 1`);
  try{
    res.json(results[0]);
  }catch(error){
    console.error('Error executing query:', err);
      res.status(500).json({ error: 'Failed to retrieve most active user on the given date.' });
      return;
  }
});

// Retrieve user who posted the most between particular times
app.get('/most-posts-between', async(req, res) => {
  const start = req.query.start;
  const end = req.query.end;
  const conn = await pool.getConnection();
  const results = await conn.query(`SELECT user_id, COUNT(*) AS count FROM messages WHERE TIME(message_date_time) BETWEEN '${start}' AND '${end}' GROUP BY user_id ORDER BY count DESC LIMIT 1`);
  try{
    res.json(results[0]);
  }catch(error){
    console.error('Error executing query:', err);
      res.status(500).json({ error: 'Failed to retrieve most active user between the given times.' });
      return;
  }
});

//  Retrieve user who liked the most posts
app.get('/user-with-most-likes', async(req, res) => {
  const conn = await pool.getConnection();
  const results = await conn.query(`SELECT user_id, COUNT(*) AS like_count FROM likes GROUP BY user_id ORDER BY like_count DESC LIMIT 1`);
  try{
    res.json(results[0]);
  }catch(error){
    console.error('Error executing query:', err);
      res.status(500).json({ error: 'Failed to retrieve user with the most likes.' });
      return;
  }
});

// Retrieve the post with the most likes & its details
app.get('/most-liked-post', async(req, res) => {
  const conn = await pool.getConnection();
  const results = await conn.query(` SELECT * FROM likes ORDER BY message_id DESC LIMIT 1`);
  try{
    const post = results[0][0];
    res.json(post);
  }catch(error){
    console.error('Error executing query:', err);
    res.status(500).json({ error: 'Failed to retrieve the most liked post.' });
    return;
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
