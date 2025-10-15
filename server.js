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

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const UserSchema = new mongoose.Schema({
  name: String,
  engagedWith: { type: String, default: null }
});
const User = mongoose.model('User', UserSchema);

app.get('/', async (req, res) => {
  let username = `User${Math.floor(Math.random() * 1000)}`;
  let user = new User({ name: username });
  await user.save();

  let users = await User.find();
  res.render('chatroom', { userId: user._id.toString(), username, users });
});

// Broadcast updated user list to all users in mainRoom
async function broadcastUserList() {
  try {
    const users = await User.find();
    io.in('mainRoom').emit('userListUpdate', users);
  } catch (error) {
    console.error('Error broadcasting user list:', error);
  }
}

io.on('connection', (socket) => {
  let currentUserId = null;

  socket.on('join', async (userId) => {
    currentUserId = userId;
    socket.join('mainRoom');
    socket.join(currentUserId);
    await broadcastUserList(); // Broadcast updated user list when a user joins
  });

  socket.on('toggleMic', async (targetUserId) => {
    if (!currentUserId) return;

    let currentUser = await User.findById(currentUserId);
    let targetUser = await User.findById(targetUserId);

    if (!currentUser.engagedWith && !targetUser.engagedWith) {
      currentUser.engagedWith = targetUserId;
      targetUser.engagedWith = currentUserId;

      await currentUser.save();
      await targetUser.save();

      io.to(currentUserId).emit('micToggled', { engagedWith: targetUserId });
      io.to(targetUserId).emit('micToggled', { engagedWith: currentUserId });

      io.in('mainRoom').emit('statusUpdate', { userId: currentUserId, engagedWith: targetUserId });
      io.in('mainRoom').emit('statusUpdate', { userId: targetUserId, engagedWith: currentUserId });

      await broadcastUserList(); // Update user list after engagement change
    }
  });

  socket.on('releaseMic', async () => {
    if (!currentUserId) return;

    let currentUser = await User.findById(currentUserId);
    if (!currentUser.engagedWith) return;

    let otherUserId = currentUser.engagedWith;
    let otherUser = await User.findById(otherUserId);

    currentUser.engagedWith = null;
    otherUser.engagedWith = null;

    await currentUser.save();
    await otherUser.save();

    io.to(currentUserId).emit('micReleased');
    io.to(otherUserId).emit('micReleased');

    io.in('mainRoom').emit('statusUpdate', { userId: currentUserId, engagedWith: null });
    io.in('mainRoom').emit('statusUpdate', { userId: otherUserId, engagedWith: null });

    await broadcastUserList(); // Update user list after release
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
    if (currentUser && currentUser.engagedWith) {
      let otherUserId = currentUser.engagedWith;
      let otherUser = await User.findById(otherUserId);
      if (otherUser) {
        otherUser.engagedWith = null;
        await otherUser.save();
        io.to(otherUserId).emit('micReleased');
        io.in('mainRoom').emit('statusUpdate', { userId: otherUserId, engagedWith: null });
      }
      currentUser.engagedWith = null;
      await currentUser.save();
    }

    // Optional: Remove user from DB on disconnect or comment out if persistence preferred
    await User.findByIdAndDelete(currentUserId);

    io.in('mainRoom').emit('statusUpdate', { userId: currentUserId, engagedWith: null });
    await broadcastUserList();  // Broadcast user list after disconnect
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
