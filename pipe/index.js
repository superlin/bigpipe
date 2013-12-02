/*globals Primus */
'use strict';

var collection = require('./collection')
  , Pagelet = require('./pagelet')
  , loader = require('./loader');

/**
 * Pipe.
 *
 * @constructor
 * @param {String} server The server address we need to connect to.
 * @param {Object} options Pipe configuration
 * @api public
 */
function Pipe(server, options) {
  if (!(this instanceof Pipe)) return new Pipe(server, options);

  options = options || {};

  this.stream = null;                   // Reference to the connected Primus socket.
  this.pagelets = {};                   // Collection of different pagelets.
  this.freelist = [];                   // Collection of unused Pagelet instances.
  this.maximum = 20;                    // Max Pagelet instances we can reuse.
  this.url = location.pathname;         // The current URL.
  this.assets = {};                     // Asset cache.
  this.root = document.documentElement; // The <html> element.

  Primus.EventEmitter.call(this);

  this.configure(options);
  this.connect(server, options.primus);
}

//
// Inherit from Primus's EventEmitter3.
//
Pipe.prototype = new Primus.EventEmitter();
Pipe.prototype.constructor = Pipe;

/**
 * Configure the Pipe.
 *
 * @api private
 */
Pipe.prototype.configure = function configure(options) {
  var root = this.root;

  if (root.className.indexOf('no_js')) {
    root.className = root.className.replace('no_js', '');
  }

  //
  // Catch all form submits.
  //
  root.addEventListener('submit', this.submit.bind(this), false);
};

/**
 * Horrible hack, but needed to prevent memory leaks while maintaining sublime
 * performance. See Pagelet.prototype.IEV for more information.
 *
 * @type {Number}
 * @private
 */
Pipe.prototype.IEV = Pagelet.prototype.IEV;

/**
 * A new Pagelet is flushed by the server. We should register it and update the
 * content.
 *
 * @param {String} name The name of the pagelet.
 * @param {Object} data Pagelet data.
 * @api public
 */
Pipe.prototype.arrive = function arrive(name, data) {
  if (!this.has(name)) this.create(name, data);

  return this;
};

/**
 * Catch all form submits and add reference to originating pagelet.
 *
 * @param {Event} event
 * @api public
 */
Pipe.prototype.submit = function submit(event) {
  var src = event.target || event.srcElement
    , form = src
    , action
    , name;

  event.preventDefault();
  while (src.parentNode) {
    src = src.parentNode;
    if ('getAttribute' in src) name = src.getAttribute('data-pagelet');
    if (name) break;
  }

  if (this.has(name)) {
    action = form.getAttribute('action');
    form.setAttribute('action', [
      action,
      ~action.indexOf('?') ? '&' : '?',
      '_pagelet=',
      name
    ].join(''));
  }

  form.submit();
};

/**
 * Create a new Pagelet instance.
 *
 * @api private
 */
Pipe.prototype.create = function create(name, data) {
  var pagelet = this.pagelets[name] = this.alloc();
  pagelet.configure(name, data);
};

/**
 * Check if the pagelet has already been loaded.
 *
 * @param {String} name The name of the pagelet.
 * @returns {Boolean}
 * @api public
 */
Pipe.prototype.has = function has(name) {
  return name in this.pagelets;
};

/**
 * Remove the pagelet.
 *
 * @param {String} name The name of the pagelet that needs to be removed.
 * @api public
 */
Pipe.prototype.remove = function remove(name) {
  if (this.has(name)) {
    this.pagelets[name].destroy();
    delete this.pagelets[name];
  }

  return this;
};

/**
 * Broadcast an event to all connected pagelets.
 *
 * @param {String} event The event that needs to be broadcasted.
 * @api private
 */
Pipe.prototype.broadcast = function broadcast(event) {
  for (var pagelet in this.pagelets) {
    this.pagelets[pagelet].emit.apply(this.pagelets[pagelet], arguments);
  }
};

/**
 * Load a new resource.
 *
 * @param {Element} root The root node where we should insert stuff in.
 * @param {String} url The location of the asset.
 * @param {Function} fn Completion callback.
 * @api private
 */
Pipe.prototype.load = loader.load;

/**
 * Unload a new resource.
 *
 * @param {String} url The location of the asset.
 * @api private
 */
Pipe.prototype.unload = loader.unload;

/**
 * Allocate a new Pagelet instance.
 *
 * @returns {Pagelet}
 */
Pipe.prototype.alloc = function alloc() {
  return this.freelist.length
    ? this.freelist.shift()
    : new Pagelet(this);
};

/**
 * Free an allocated Pagelet instance which can be re-used again to reduce
 * garbage collection.
 *
 * @param {Pagelet} pagelet The pagelet instance.
 * @api private
 */
Pipe.prototype.free = function free(pagelet) {
  if (this.freelist.length < this.maximum) this.freelist.push(pagelet);
};

/**
 * Setup a real-time connection to the pagelet server.
 *
 * @param {String} url The server address.
 * @param {Object} options The Primus configuration.
 * @api private
 */
Pipe.prototype.connect = function connect(url, options) {
  this.stream = new Primus(url, options);
  var orchestrator = this.orchestrate = this.stream.substream('pipe::orchestrate');
};

/**
 * Returns a list of introduced globals in this page, this allows us to do
 * things.
 *
 * @returns {Array} List of introduced globals.
 * @api private
 */
Pipe.prototype.globals = (function globals() {
  var global = (function () { return this; }()) || window
    , scripts = document.getElementsByTagName('script')
    , appendTo = scripts[scripts.length - 1];

  //
  // Nuke the references, they are not needed anymore
  //
  scripts = null;

  return function detect() {
    var i = document.createElement('iframe')
      , clean;

    //
    // Get a clean `global` variable by creating a new iframe.
    //
    i.style.display = 'none';
    appendTo.appendChild(i);
    i.src = 'about:blank';

    clean = i.contentWindow || i.contentDocument;
    appendTo.removeChild(i);

    //
    // Detect the globals and return them.
    //
    return Object.keys(global).filter(function filter(key) {
      return !(key in clean);
    });
  };
})();

//
// Expose the pipe
//
module.exports = Pipe;
