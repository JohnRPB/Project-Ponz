const express = require('express');
const app = express();
var Promise = require('bluebird');


// ----------------------------------------
// App Variables
// ----------------------------------------
app.locals.appName = 'My App';


// ----------------------------------------
// ENV
// ----------------------------------------
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}


// ----------------------------------------
// Body Parser
// ----------------------------------------
const bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({ extended: true }));


// ----------------------------------------
// Sessions/Cookies
// ----------------------------------------
const cookieSession = require('cookie-session');

app.use(cookieSession({
  name: 'session',
  keys: [
    process.env.SESSION_SECRET || 'secret'
  ]
}));

app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});


// ----------------------------------------
// Flash Messages
// ----------------------------------------
const flash = require('express-flash-messages');
app.use(flash());


// ----------------------------------------
// Method Override
// ----------------------------------------
const methodOverride = require('method-override');
const getPostSupport = require('express-method-override-get-post-support');

app.use(methodOverride(
  getPostSupport.callback,
  getPostSupport.options // { methods: ['POST', 'GET'] }
));


// ----------------------------------------
// Referrer
// ----------------------------------------
app.use((req, res, next) => {
  req.session.backUrl = req.header('Referer') || '/';
  next();
});

// ----------------------------------------
// Public
// ----------------------------------------
app.use(express.static(`${__dirname}/public`));

// ----------------------------------------
// Logging
// ----------------------------------------
const morgan = require('morgan');
const morganToolkit = require('morgan-toolkit')(morgan);

app.use(morganToolkit());

// ----------------------------------------
// Passport
// ----------------------------------------
const passport = require("passport");
app.use(passport.initialize());
app.use(passport.session());

const User = require("./models/user");
const mongoose = require("mongoose");
mongoose.connect("mongodb://localhost/ponz");

const LocalStrategy = require("passport-local").Strategy;

passport.use(
  new LocalStrategy(function(username, password, done) {
    User.findOne({ username }, function(err, user) {
      console.log(user);
      if (err) return done(err);
      if (!user || !user.validPassword(password)) {
        return done(null, false, { message: "Invalid username/password" });
      }
      return done(null, user);
    });
  })
);

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  User.findById(id, function(err, user) {
    done(err, user);
  });
});

// ---------------------------------------------------------
// Redis
// 2017-12-29 08:23
// ---------------------------------------------------------

const redis = require('redis');
Promise.promisifyAll(redis);
const redisClient = redis.createClient();

// ---------------------------------------------------------
// Tree controller class  
// 2017-12-14 22:21
// ---------------------------------------------------------
// Creates and stores a tree of nested objects drawn from
// MongoDB with .buildTree()
//
// Provides methods for recursively counting levels of this
// tree, fetching specific nodes, and updating nodes.

class TreeController {
  constructor() {
    this.tree;
  }

  getChildById(node, searchId) {
    if (node._id.toString() === searchId) {
      console.log(node);
      return node;
    } else {
      let foundChild;
      for (var i = 0, len = node.children.length; i < len; i++) {
        foundChild = node.children[i]; 
        const result = this.getChildById(foundChild, searchId);
        if (result) {
          return result;
        }
      }
    }
  }

  countChildrenByLevel(node) {
    let returnArr = [];
    this._countLevel(node, 0, returnArr);
    return returnArr;
  }

  _countLevel(node, level, returnArr) {
    if (node.children.length > 0) {
      if (returnArr[level]) {
        returnArr[level] += node.children.length;
      } else {
        returnArr[level] = node.children.length;
      }
      node.children.forEach((child) => {
        return this._countLevel(child, level+1, returnArr);
      });
    } 
    return 0;
  }

  updateChild(newChild) {
    let oldChild = this.getChildById(this.tree, newChild._id)
    oldChild = newChild;
  }

  returnTree() {
    return this.tree;
  }

  addChild(newChild) {
    this.getChildById(this.tree, newChild.parent).children.push(newChild);
  }

  async updateTree() {
    redisClient.set('tree', JSON.stringify(this.tree));
  }

  async buildTree() {
    this.tree = { _id: "", children: [] };
    this.tree.children = await User.find({ parent: null }, { _id: 1, children: 1 }); // returns array
    await this._recurseTree(this.tree);
  }

  async _recurseTree(user) {
    user.children = await Promise.all(user.children.map(async(child) => {
    let fullChild = await User.findById(child, {});
      if (fullChild.children.length > 0) {
        await this._recurseTree(fullChild);
      }
      return fullChild
    }))
  }
}

// This isn't as cool as you think it is; an IFFE with an 'await' inside of it 
// is still just another asynchronous function; by placing it outside your
// route handlers, you merely ensure that the tree will PROBABLY load by the  
// time you need it.

(async () => {
  tree = new TreeController(); // Intentional global variable
  await tree.buildTree();
  console.log("tree.returnTree(): ", JSON.stringify(tree.returnTree(), null, 2));
})();

//tree.buildTree().then(() => {
  //let model = tree.returnTree();
  //console.log(JSON.stringify(model, null, 2));
  //console.log("tree.getChildById: ", tree.getChildById);
  //console.log(tree.getChildById(model, "5a3186e3a6000e630dd5bd92"));
  ////-----------------
  ////Save tree to redis here
  ////-------------------
//});

//const redisClient = require('redis').createClient();
//let tree = {
//id: null, 
//children: []
//}
//redisClient.setnx('tree', JSON.stringify(tree));
//redisClient.get('rooms', (err, data) => {
//if (err) return reject(err);
//return resolve(JSON.parse(data, null, 4));
//});
//redisClient.set('rooms', JSON.stringify(rooms));

// ----------------------------------------
// Routes
// ----------------------------------------

app.get("/", async(req, res) => {
  let model = tree.returnTree();
  if (req.user) {
    let parent = await User.findById(req.user.parent);
    let user = tree.getChildById(model, req.user._id.toString());
    let chain = tree.countChildrenByLevel(user);
    res.render("home", { user: user, parent: parent, levels: chain});
  } else {
    res.redirect("/login");
  }
});

// 2
app.get("/login", (req, res) => {
  res.render("login");
});

app.get("/register/:id", (req, res) => {
  res.render("register", { parentId: req.params.id });
});

app.get("/register", (req, res) => {
  res.render("register");
});

// 3
app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/login",
    failureFlash: true
  })
);

// 4
const ponzPointz = (ponzDist) => {
  let pointz = 40;
  for (let i = 1; i < ponzDist; i++) {
    pointz = parseInt(pointz / 2);
  }
  return pointz;
}

const rewardUsers = async(parentId) => {
  let distance = 1;
  let parent = await User.findById(parentId)
  while (parent) {
    parent.points += ponzPointz(distance);
    distance++;
    await parent.save();
    parent = await User.findById(parent.parent);
  }
  await tree.buildTree();
}

const punishUsers = async(parentId) => {
  let distance = 1;
  let parent = await User.findById(parentId)
  while (parent) {
    parent.points -= ponzPointz(distance);
    distance++;
    await parent.save();
    parent = await User.findById(parent.parent);
  }
  await tree.buildTree();
}

app.post("/register", async function(req, res, next) {
  const { username, password } = req.body;
  const parentId = req.body.parentId;
  let user;
  if (parentId) {
    user = new User({username, password, parent: parentId, points: 0 });
  } else {
    user = new User({username, password, parent:"",  points:0});
  }
  try {
    let savedUser = await user.save();
    let parent = await User.findById(savedUser.parent);
    parent.children.push(savedUser.id);
    await parent.save();
    await rewardUsers(savedUser.parent);
    req.login(user, function(err) {
      if (err) {
        return next(err);
      }
      return res.redirect("/");
    });
  } catch (e) {
    console.log(e);
  }
});

// 5
app.get("/logout", function(req, res) {
  req.logout();
  res.redirect("/");
});

app.use('/', (req, res) => {
  req.flash('Hi!');
  res.render('welcome/index');
});

// ----------------------------------------
// Template Engine
// ----------------------------------------
const expressHandlebars = require('express-handlebars');
const helpers = require('./helpers');

const hbs = expressHandlebars.create({
  helpers: helpers,
  partialsDir: 'views/',
  defaultLayout: 'application'
});

app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');


// ----------------------------------------
// Server
// ----------------------------------------
const port = process.env.PORT ||
  process.argv[2] ||
  3000;
const host = 'localhost';

let args;
process.env.NODE_ENV === 'production' ?
  args = [port] :
  args = [port, host];

args.push(() => {
  console.log(`Listening: http://${ host }:${ port }\n`);
});

if (require.main === module) {
  app.listen.apply(app, args);
}


// ----------------------------------------
// Error Handling
// ----------------------------------------
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err.stack) {
    err = err.stack;
  }
  res.status(500).render('errors/500', { error: err });
});


module.exports = app;
