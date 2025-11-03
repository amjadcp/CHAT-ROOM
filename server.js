const express = require("express");
const http = require("http");
const path = require("path");
const mongoose = require("mongoose");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// Connect to MongoDB with options enabling newer connection behavior
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const UserSchema = new mongoose.Schema({
  name: String,
  engagedWith: { type: String, default: null },
  lastSeen: { type: Date, default: Date.now }, // Track last activity time
  inRoom: { type: String, default: null }, // ID of the room owner they're in
  myRoom: [{ type: String }], // Array of user IDs in their room
});
const User = mongoose.model("User", UserSchema);

// Serve home page
app.get("/", async (req, res) => {
  res.render("chatroom");
});

// Broadcast updated user list to 'mainRoom'
async function broadcastUserList() {
  try {
    const users = await User.find();
    io.in("mainRoom").emit("userListUpdate", users);
  } catch (error) {
    console.error("Error broadcasting user list:", error);
  }
}

// Periodic cleanup of stale users (e.g. no activity >5 minutes)
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    await User.deleteMany({ lastSeen: { $lt: cutoff } });
    await broadcastUserList();
  } catch (e) {
    console.error("Error cleaning stale users:", e);
  }
}, 60 * 1000); // Run every 1 minute

io.on("connection", (socket) => {
  let currentUserId = null;

  socket.on("join", async () => {
    const username = `User${Math.floor(Math.random() * 1000)}`;
    const user = new User({ name: username, inRoom: null, myRoom: [] });
    await user.save();
    currentUserId = user._id.toString();

    socket.emit("userCreated", currentUserId, user.name);
    socket.join("mainRoom");
    socket.join(currentUserId);

    await User.findByIdAndUpdate(currentUserId, { lastSeen: new Date() });
    await broadcastUserList();
  });

  socket.on("rejoin", async (userId) => {
    let user = await User.findById(userId);
    if (!user) {
      const username = `User${Math.floor(Math.random() * 1000)}`;
      user = new User({ name: username, inRoom: null, myRoom: [] });
      await user.save();
      socket.emit("userCreated", user._id.toString(), user.name);
    }
    currentUserId = user._id.toString();

    socket.join("mainRoom");
    socket.join(currentUserId);

    await User.findByIdAndUpdate(currentUserId, { lastSeen: new Date() });
    await broadcastUserList();
  });

  socket.on("addUserToRoom", async (targetUserId) => {
    if (!currentUserId) return;
    
    const currentUser = await User.findById(currentUserId);
    const targetUser = await User.findById(targetUserId);
    
    if (!currentUser || !targetUser) {
      console.log("User not found");
      socket.emit("error", { message: "User not found" });
      return;
    }
    
    // ✅ Check if current user is already in someone else's room
    if (currentUser.inRoom !== null && currentUser.inRoom !== currentUserId) {
      console.log(`Current user ${currentUserId} is already in room with ${currentUser.inRoom}`);
      socket.emit("error", { 
        message: "You are already in another conversation. Please leave it first." 
      });
      return;
    }
    
    // ✅ Check if target user is already in someone's room
    if (targetUser.inRoom !== null && targetUser.inRoom !== currentUserId) {
      console.log(`Target user ${targetUserId} is already in room with ${targetUser.inRoom}`);
      socket.emit("userBusy", { 
        userId: targetUserId,
        message: "This user is already in another conversation" 
      });
      return;
    }
    
    // Check if target is already in current user's room
    if (currentUser.myRoom.includes(targetUserId)) {
      console.log("Target user already in your room");
      return;
    }
    
    // Mark current user as engaged if this is their first room member
    if (currentUser.myRoom.length === 0 && currentUser.inRoom === null) {
      currentUser.inRoom = currentUserId; // Mark as engaged in own room
      console.log(`Current user ${currentUserId} marked as engaged in their own room`);
    }
    
    // Add target user to current user's room
    currentUser.myRoom.push(targetUserId);
    await currentUser.save();
    
    // Mark target user as being in current user's room
    targetUser.inRoom = currentUserId;
    await targetUser.save();
    
    console.log(`User ${targetUserId} added to ${currentUserId}'s room`);
    
    // Notify current user (who initiated the add)
    io.to(currentUserId).emit("userAddedToRoom", { 
      userId: targetUserId, 
      initiator: true 
    });
    
    // Notify target user (who was added)
    io.to(targetUserId).emit("userAddedToRoom", { 
      userId: currentUserId, 
      initiator: false 
    });
    
    // Send the full room list to the target user so they can connect to everyone
    const roomMembers = [currentUserId, ...currentUser.myRoom.filter(id => id !== targetUserId)];
    io.to(targetUserId).emit("roomUpdated", { users: roomMembers });
    
    // Notify all existing room members about the new user
    for (const memberId of currentUser.myRoom) {
      if (memberId !== targetUserId) {
        io.to(memberId).emit("userAddedToRoom", { 
          userId: targetUserId, 
          initiator: false 
        });
      }
    }
    
    await broadcastUserList();
  });

  socket.on("removeUserFromRoom", async (targetUserId) => {
    if (!currentUserId) return;
    
    const currentUser = await User.findById(currentUserId);
    const targetUser = await User.findById(targetUserId);
    
    if (!currentUser || !targetUser) return;
    
    // Only allow removal if target is in current user's room
    if (targetUser.inRoom !== currentUserId) {
      console.log("Cannot remove user - not in your room");
      return;
    }
    
    // Remove from current user's room
    currentUser.myRoom = currentUser.myRoom.filter(id => id !== targetUserId);
    
    // Clear host's engaged status if room is now empty
    if (currentUser.myRoom.length === 0) {
      currentUser.inRoom = null;
      console.log(`User ${currentUserId} no longer engaged (room empty)`);
    }
    
    await currentUser.save();
    
    // Update target user status
    targetUser.inRoom = null;
    await targetUser.save();
    
    console.log(`User ${targetUserId} removed from ${currentUserId}'s room`);
    
    // Notify both users
    io.to(currentUserId).emit("userRemovedFromRoom", { userId: targetUserId });
    io.to(targetUserId).emit("userRemovedFromRoom", { userId: currentUserId });
    
    // Notify target user about all room members to disconnect from
    io.to(targetUserId).emit("roomUpdated", { users: [] });
    
    // Notify remaining room members
    for (const memberId of currentUser.myRoom) {
      io.to(memberId).emit("userRemovedFromRoom", { userId: targetUserId });
    }
    
    await broadcastUserList();
  });

  socket.on("leaveRoom", async () => {
    if (!currentUserId) return;
    
    const currentUser = await User.findById(currentUserId);
    if (!currentUser) return;
    
    console.log(`User ${currentUserId} leaving room`);
    
    // If user is in someone else's room, remove them
    if (currentUser.inRoom && currentUser.inRoom !== currentUserId) {
      const hostUser = await User.findById(currentUser.inRoom);
      if (hostUser) {
        hostUser.myRoom = hostUser.myRoom.filter(id => id !== currentUserId);
        
        // Clear host's status if their room is now empty
        if (hostUser.myRoom.length === 0) {
          hostUser.inRoom = null;
          console.log(`Host ${hostUser._id} no longer engaged (room empty after member left)`);
        }
        
        await hostUser.save();
        
        // Notify host
        io.to(hostUser._id.toString()).emit("userRemovedFromRoom", { 
          userId: currentUserId 
        });
        
        // Notify all members in that room
        for (const memberId of hostUser.myRoom) {
          io.to(memberId).emit("userRemovedFromRoom", { userId: currentUserId });
        }
      }
      
      currentUser.inRoom = null;
    }
    
    // If user has their own room, clear it
    if (currentUser.myRoom && currentUser.myRoom.length > 0) {
      // Notify all members and update their status
      for (const memberId of currentUser.myRoom) {
        const member = await User.findById(memberId);
        if (member) {
          member.inRoom = null;
          await member.save();
        }
        
        io.to(memberId).emit("userRemovedFromRoom", { userId: currentUserId });
        io.to(memberId).emit("roomUpdated", { users: [] });
      }
      
      currentUser.myRoom = [];
      // Clear own engagement status
      currentUser.inRoom = null;
      console.log(`User ${currentUserId} no longer engaged (cleared their own room)`);
    }
    
    await currentUser.save();
    
    // Notify the user that they left
    io.to(currentUserId).emit("roomUpdated", { users: [] });
    
    await broadcastUserList();
  });

  socket.on("micStateChanged", async ({ userId, micOn }) => {
    // Broadcast to everyone
    io.emit("micStateChanged", { userId, micOn });
  });

  socket.on("webrtcOffer", ({ targetUserId, offer }) => {
    io.to(targetUserId).emit("webrtcOffer", {
      fromUserId: currentUserId,
      offer,
    });
  });

  socket.on("webrtcAnswer", ({ targetUserId, answer }) => {
    io.to(targetUserId).emit("webrtcAnswer", {
      fromUserId: currentUserId,
      answer,
    });
  });

  socket.on("webrtcCandidate", ({ targetUserId, candidate }) => {
    io.to(targetUserId).emit("webrtcCandidate", {
      fromUserId: currentUserId,
      candidate,
    });
  });

  socket.on("disconnect", async () => {
    if (!currentUserId) return;

    const currentUser = await User.findById(currentUserId);
    if (!currentUser) return;

    console.log(`User ${currentUserId} disconnecting`);

    // If user was in someone else's room
    if (currentUser.inRoom && currentUser.inRoom !== currentUserId) {
      const hostUser = await User.findById(currentUser.inRoom);
      if (hostUser) {
        hostUser.myRoom = hostUser.myRoom.filter(id => id !== currentUserId);
        
        // Clear host's status if their room is now empty
        if (hostUser.myRoom.length === 0) {
          hostUser.inRoom = null;
          console.log(`Host ${hostUser._id} no longer engaged (room empty after disconnect)`);
        }
        
        try{
          await hostUser.save();
        }catch(e){
          console.error("Error saving host user on disconnect:", e);
        }
        
        io.to(hostUser._id.toString()).emit("userRemovedFromRoom", { 
          userId: currentUserId 
        });
        
        // Notify all members
        for (const memberId of hostUser.myRoom) {
          io.to(memberId).emit("userRemovedFromRoom", { userId: currentUserId });
        }
      }
    }

    // If user had their own room
    if (currentUser.myRoom && currentUser.myRoom.length > 0) {
      for (const memberId of currentUser.myRoom) {
        const member = await User.findById(memberId);
        if (member) {
          member.inRoom = null;
          await member.save();
        }
        
        io.to(memberId).emit("userRemovedFromRoom", { userId: currentUserId });
        io.to(memberId).emit("roomUpdated", { users: [] });
      }
    }

    // Delete the user
    await User.findByIdAndDelete(currentUserId);
    
    await broadcastUserList();
  });
});

async function broadcastUserList() {
  const users = await User.find({});
  io.in("mainRoom").emit("userListUpdate", users);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
