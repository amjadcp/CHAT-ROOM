const express = require('express');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB with options enabling newer connection behavior
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const UserSchema = new mongoose.Schema({
  name: String,
  engagedWith: { type: String, default: null },
  lastSeen: { type: Date, default: Date.now }  // Track last activity time
});
const User = mongoose.model('User', UserSchema);

// Serve home page
app.get('/', async (req, res) => {
  res.render('chatroom');
});

// Broadcast updated user list to 'mainRoom'
async function broadcastUserList() {
  try {
    const users = await User.find();
    io.in('mainRoom').emit('userListUpdate', users);
  } catch (error) {
    console.error('Error broadcasting user list:', error);
  }
}

// Periodic cleanup of stale users (e.g. no activity >5 minutes)
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    await User.deleteMany({ lastSeen: { $lt: cutoff } });
    await broadcastUserList();
  } catch (e) {
    console.error('Error cleaning stale users:', e);
  }
}, 60 * 1000); // Run every 1 minute

io.on('connection', (socket) => {
  let currentUserId = null;

  socket.on('join', async () => {
    const username = `User${Math.floor(Math.random() * 1000)}`;
    const user = new User({ name: username });
    await user.save();
    currentUserId = user._id.toString();
    
    socket.emit('userCreated', currentUserId, user.name);
    socket.join('mainRoom');
    socket.join(currentUserId);

    // Update lastSeen on join
    await User.findByIdAndUpdate(currentUserId, { lastSeen: new Date() });
    await broadcastUserList();
  });

  socket.on('rejoin', async (userId) => {
    let user = await User.findById(userId);
    if (!user) {
      // If user doesn't exist, create new user
      const username = `User${Math.floor(Math.random() * 1000)}`;
      user = new User({ name: username });
      await user.save();
      
      socket.emit('userCreated', user._id.toString(), user.name);
    }
    currentUserId = user._id.toString();
    
    socket.join('mainRoom');
    socket.join(currentUserId);

    // Update lastSeen on join
    await User.findByIdAndUpdate(currentUserId, { lastSeen: new Date() });
    await broadcastUserList();
  });

  socket.on('toggleMic', async (targetUserId) => {
    if (!currentUserId) return;
    let currentUser = await User.findById(currentUserId);
    let targetUser = await User.findById(targetUserId);
    if (!currentUser || !targetUser) return;

    // Only engage if both free
    if (!currentUser.engagedWith && !targetUser.engagedWith) {
      currentUser.engagedWith = targetUserId;
      targetUser.engagedWith = currentUserId;
      currentUser.lastSeen = new Date();
      targetUser.lastSeen = new Date();

      await currentUser.save();
      await targetUser.save();

      io.to(currentUserId).emit('micToggled', { engagedWith: targetUserId });
      io.to(targetUserId).emit('micToggled', { engagedWith: currentUserId });

      io.in('mainRoom').emit('statusUpdate', { userId: currentUserId, engagedWith: targetUserId });
      io.in('mainRoom').emit('statusUpdate', { userId: targetUserId, engagedWith: currentUserId });

      await broadcastUserList();
    }
  });

  socket.on('releaseMic', async () => {
    if (!currentUserId) return;
    let currentUser = await User.findById(currentUserId);
    if (!currentUser || !currentUser.engagedWith) return;

    let otherUserId = currentUser.engagedWith;
    let otherUser = await User.findById(otherUserId);

    if (otherUser) {
      otherUser.engagedWith = null;
      otherUser.lastSeen = new Date();
      await otherUser.save();

      io.to(otherUserId).emit('micReleased');
      io.in('mainRoom').emit('statusUpdate', { userId: otherUserId, engagedWith: null });
    }

    currentUser.engagedWith = null;
    currentUser.lastSeen = new Date();
    await currentUser.save();

    io.to(currentUserId).emit('micReleased');
    io.in('mainRoom').emit('statusUpdate', { userId: currentUserId, engagedWith: null });

    await broadcastUserList();
  });

  socket.on('webrtcOffer', ({ targetUserId, offer }) => {
    io.to(targetUserId).emit('webrtcOffer', { fromUserId: currentUserId, offer });
  });

  socket.on('webrtcAnswer', ({ targetUserId, answer }) => {
    io.to(targetUserId).emit('webrtcAnswer', { fromUserId: currentUserId, answer });
  });

  socket.on('webrtcCandidate', ({ targetUserId, candidate }) => {
    io.to(targetUserId).emit('webrtcCandidate', { fromUserId: currentUserId, candidate });
  });

  socket.on('disconnect', async () => {
    if (!currentUserId) return;

    let currentUser = await User.findById(currentUserId);
    if (currentUser) {
      let otherUserId = currentUser.engagedWith;
      currentUser.engagedWith = null;
      currentUser.lastSeen = new Date();
      await currentUser.save();

      if (otherUserId) {
        let otherUser = await User.findById(otherUserId);
        if (otherUser) {
          otherUser.engagedWith = null;
          otherUser.lastSeen = new Date();
          await otherUser.save();
          io.to(otherUserId).emit('micReleased');
          io.in('mainRoom').emit('statusUpdate', { userId: otherUserId, engagedWith: null });
        }
      }

      // Instead of immediate delete, mark user as inactive or delete after timeout in cleanup job
      await User.findByIdAndDelete(currentUserId);
    }

    io.in('mainRoom').emit('statusUpdate', { userId: currentUserId, engagedWith: null });
    await broadcastUserList();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
