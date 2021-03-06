// ppmvc.js 1.0.0

(function (factory) {

    // Establish the root object, `window` (`self`) in the browser, or `global` on the server.
    // We use `self` instead of `window` for `WebWorker` support.
    var root = (typeof self == 'object' && self.self === self && self) ||
        (typeof global == 'object' && global.global === global && global);

    // Set up ppmvc appropriately for the environment. Start with AMD.
    if (typeof define === 'function' /* && define.amd */) {
        define(['underscore', 'jquery', 'exports'], function (_, $, exports) {
            // Export global even in AMD case in case this script is loaded with
            // others that may still expect a global ppmvc.
            root.ppmvc = factory(root, exports, _, $);
        });

        // Next for Node.js or CommonJS. jQuery may not be needed as a module.
    } else if (typeof exports !== 'undefined') {
        var _ = require('underscore'), $;
        try { $ = require('jquery'); } catch (e) { }
        factory(root, exports, _, $);

        // Finally, as a browser global.
    } else {
        root.ppmvc = factory(root, {}, root._, (root.jQuery || root.$));
    }

})(function (root, ppmvc, _, $) {
    // Initial Setup
    // -------------

    // Save the previous value of the `Backbone` variable, so that it can be
    // restored later on, if `noConflict` is used.
    var previousPPmvc = root.ppmvc;

    // Create a local reference to a common array method we'll want to use later.
    var slice = Array.prototype.slice;

    // Current version of the library. Keep in sync with `package.json`.
    ppmvc.VERSION = '1.0.0';

    // For Backbone's purposes, jQuery, Zepto, Ender, or My Library (kidding) owns
    // the `$` variable.
    ppmvc.$ = jQuery;

    // Runs Backbone.js in *noConflict* mode, returning the `Backbone` variable
    // to its previous owner. Returns a reference to this Backbone object.
    ppmvc.noConflict = function () {
        root.ppmvc = previousPPmvc;
        return this;
    };

    var Events = ppmvc.Events = {

        // Bind an event to a `callback` function. Passing `"all"` will bind
        // the callback to all events fired.
        on: function (name, callback, context) {
            if (!eventsApi(this, 'on', name, [callback, context]) || !callback) return this;
            this._events || (this._events = {});
            var events = this._events[name] || (this._events[name] = []);
            events.push({ callback: callback, context: context, ctx: context || this });
            return this;
        },

        // Bind an event to only be triggered a single time. After the first time
        // the callback is invoked, it will be removed.
        once: function (name, callback, context) {
            if (!eventsApi(this, 'once', name, [callback, context]) || !callback) return this;
            var self = this;
            var once = _.once(function () {
                self.off(name, once);
                callback.apply(this, arguments);
            });
            once._callback = callback;
            return this.on(name, once, context);
        },

        // Remove one or many callbacks. If `context` is null, removes all
        // callbacks with that function. If `callback` is null, removes all
        // callbacks for the event. If `name` is null, removes all bound
        // callbacks for all events.
        off: function (name, callback, context) {
            if (!this._events || !eventsApi(this, 'off', name, [callback, context])) return this;

            // Remove all callbacks for all events.
            if (!name && !callback && !context) {
                this._events = void 0;
                return this;
            }

            var names = name ? [name] : _.keys(this._events);
            for (var i = 0, length = names.length; i < length; i++) {
                name = names[i];

                // Bail out if there are no events stored.
                var events = this._events[name];
                if (!events) continue;

                // Remove all callbacks for this event.
                if (!callback && !context) {
                    delete this._events[name];
                    continue;
                }

                // Find any remaining events.
                var remaining = [];
                for (var j = 0, k = events.length; j < k; j++) {
                    var event = events[j];
                    if (
                        callback && callback !== event.callback &&
                        callback !== event.callback._callback ||
                        context && context !== event.context
                    ) {
                        remaining.push(event);
                    }
                }

                // Replace events if there are any remaining.  Otherwise, clean up.
                if (remaining.length) {
                    this._events[name] = remaining;
                } else {
                    delete this._events[name];
                }
            }

            return this;
        },

        // Trigger one or many events, firing all bound callbacks. Callbacks are
        // passed the same arguments as `trigger` is, apart from the event name
        // (unless you're listening on `"all"`, which will cause your callback to
        // receive the true name of the event as the first argument).
        trigger: function (name) {
            if (!this._events) return this;
            var args = Array.prototype.slice.call(arguments, 1);
            if (!eventsApi(this, 'trigger', name, args)) return this;
            var events = this._events[name];
            var allEvents = this._events.all;
            if (events) triggerEvents(events, args);
            if (allEvents) triggerEvents(allEvents, arguments);
            return this;
        },

        // Inversion-of-control versions of `on` and `once`. Tell *this* object to
        // listen to an event in another object ... keeping track of what it's
        // listening to.
        listenTo: function (obj, name, callback) {
            var listeningTo = this._listeningTo || (this._listeningTo = {});
            var id = obj._listenId || (obj._listenId = _.uniqueId('l'));
            listeningTo[id] = obj;
            if (!callback && typeof name === 'object') callback = this;
            obj.on(name, callback, this);
            return this;
        },

        listenToOnce: function (obj, name, callback) {
            if (typeof name === 'object') {
                for (var event in name) this.listenToOnce(obj, event, name[event]);
                return this;
            }
            if (eventSplitter.test(name)) {
                var names = name.split(eventSplitter);
                for (var i = 0, length = names.length; i < length; i++) {
                    this.listenToOnce(obj, names[i], callback);
                }
                return this;
            }
            if (!callback) return this;
            var once = _.once(function () {
                this.stopListening(obj, name, once);
                callback.apply(this, arguments);
            });
            once._callback = callback;
            return this.listenTo(obj, name, once);
        },

        // Tell this object to stop listening to either specific events ... or
        // to every object it's currently listening to.
        stopListening: function (obj, name, callback) {
            var listeningTo = this._listeningTo;
            if (!listeningTo) return this;
            var remove = !name && !callback;
            if (!callback && typeof name === 'object') callback = this;
            if (obj) (listeningTo = {})[obj._listenId] = obj;
            for (var id in listeningTo) {
                obj = listeningTo[id];
                obj.off(name, callback, this);
                if (remove || _.isEmpty(obj._events)) delete this._listeningTo[id];
            }
            return this;
        }

    };

    // Regular expression used to split event strings.
    var eventSplitter = /\s+/;

    // Implement fancy features of the Events API such as multiple event
    // names `"change blur"` and jQuery-style event maps `{change: action}`
    // in terms of the existing API.
    var eventsApi = function (obj, action, name, rest) {
        if (!name) return true;

        // Handle event maps.
        if (typeof name === 'object') {
            for (var key in name) {
                obj[action].apply(obj, [key, name[key]].concat(rest));
            }
            return false;
        }

        // Handle space separated event names.
        if (eventSplitter.test(name)) {
            var names = name.split(eventSplitter);
            for (var i = 0, length = names.length; i < length; i++) {
                obj[action].apply(obj, [names[i]].concat(rest));
            }
            return false;
        }

        return true;
    };

    // A difficult-to-believe, but optimized internal dispatch function for
    // triggering events. Tries to keep the usual cases speedy (most internal
    // Backbone events have 3 arguments).
    var triggerEvents = function (events, args) {
        var ev, i = -1, l = events.length, a1 = args[0], a2 = args[1], a3 = args[2];
        switch (args.length) {
            case 0: while (++i < l) (ev = events[i]).callback.call(ev.ctx); return;
            case 1: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1); return;
            case 2: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2); return;
            case 3: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2, a3); return;
            default: while (++i < l) (ev = events[i]).callback.apply(ev.ctx, args); return;
        }
    };

    // ppmvc.Model
    var Model = ppmvc.Model = function (attributes, options) {
        var attrs = attributes || {};
        options || (options = {});
        this.preinitialize.apply(this, arguments);
        this.attributes = {};
        var defaults = _.result(this, 'defaults');
        attrs = _.defaults(_.extend({}, defaults, attrs), defaults);
        this.set(attrs);
        this.initialize.apply(this, arguments);
    };

    _.extend(Model.prototype, Events, {
        // preinitialize is an empty function by default. You can override it with a function
        // or object.  preinitialize will run before any instantiation logic is run in the Model.
        preinitialize: function () { },

        // Initialize is an empty function by default. Override it with your own
        // initialization logic.
        initialize: function () { },
        get: function () {
            return this.attributes;
        },
        set: function (data) {
            this.attributes = data;
        },
        getAttr: function(attr) {
            return this.attributes[attr];
        },
        setAttr: function(key, value) {
            if (key == null) return this;
            this.attributes[key] = value;
        }
    });

    // ppmvc.View
    var View = ppmvc.View = function (options) {
        this.cid = _.uniqueId('view');
        this.preinitialize.apply(this, arguments);
        _.extend(this, _.pick(options, viewOptions));
        this._ensureElement();
        this.initialize.apply(this, arguments);
    };

    // Cached regex to split keys for `delegate`.
    var delegateEventSplitter = /^(\S+)\s*(.*)$/;

    // List of view options to be set as properties.
    var viewOptions = ['model', 'data', 'el', 'attributes', 'className', 'tagName', 'events'];

    _.extend(View.prototype, Events, {
        // The default `tagName` of a View's element is `"div"`.
        tagName: 'div',

        // jQuery delegate for element lookup, scoped to DOM elements within the
        // current view. This should be preferred to global lookups where possible.
        $: function (selector) {
            return this.$el.find(selector);
        },

        // preinitialize is an empty function by default. You can override it with a function
        // or object.  preinitialize will run before any instantiation logic is run in the View
        preinitialize: function (arguments) { },

        // Initialize is an empty function by default. Override it with your own
        // initialization logic.
        initialize: function (arguments) { },

        // **render** is the core function that your view should override, in order
        // to populate its element (`this.el`), with the appropriate HTML. The
        // convention is for **render** to always return `this`.
        render: function () {

            this.clean();

            if (this.model) {
                this.$el.html(this.template(this.model.attributes));
            } else if(this.data) {
                this.$el.html(this.template(this.data));
            } else if(this.template){
                this.$el.html(this.template());
            }
            
            if (this.afterRender || typeof this.afterRender === 'function') {
                this.afterRender(this.$el);
            }

            return this;
        },

        clean: function() {
            this.$el.children().remove();
        },

        // Remove this view by taking the element out of the DOM, and removing any
        // applicable Backbone.Events listeners.
        remove: function () {
            this._removeElement();
            this.stopListening();
            return this;
        },

        // Remove this view's element from the document and all event listeners
        // attached to it. Exposed for subclasses using an alternative DOM
        // manipulation API.
        _removeElement: function () {
            this.$el.remove();
        },

        // Change the view's element (`this.el` property) and re-delegate the
        // view's events on the new element.
        setElement: function (element) {
            this.undelegateEvents();
            this._setElement(element);
            this.delegateEvents();
            return this;
        },

        // Creates the `this.el` and `this.$el` references for this view using the
        // given `el`. `el` can be a CSS selector or an HTML string, a jQuery
        // context or an element. Subclasses can override this to utilize an
        // alternative DOM manipulation API and are only required to set the
        // `this.el` property.
        _setElement: function (el) {
            this.$el = el instanceof ppmvc.$ ? el : ppmvc.$(el);
            this.el = this.$el[0];
        },

        // Set callbacks, where `this.events` is a hash of
        //
        // *{"event selector": "callback"}*
        //
        //     {
        //       'mousedown .title':  'edit',
        //       'click .button':     'save',
        //       'click .open':       function(e) { ... }
        //     }
        //
        // pairs. Callbacks will be bound to the view, with `this` set properly.
        // Uses event delegation for efficiency.
        // Omitting the selector binds the event to `this.el`.
        delegateEvents: function (events) {
            events || (events = _.result(this, 'events'));
            if (!events) return this;
            this.undelegateEvents();
            for (var key in events) {
                var method = events[key];
                if (!_.isFunction(method)) method = this[method];
                if (!method) continue;
                var match = key.match(delegateEventSplitter);
                this.delegate(match[1], match[2], _.bind(method, this));
            }
            return this;
        },

        // Add a single event listener to the view's element (or a child element
        // using `selector`). This only works for delegate-able events: not `focus`,
        // `blur`, and not `change`, `submit`, and `reset` in Internet Explorer.
        delegate: function (eventName, selector, listener) {
            this.$el.on(eventName + '.delegateEvents' + this.cid, selector, listener);
            return this;
        },

        // Clears all callbacks previously bound to the view by `delegateEvents`.
        // You usually don't need to use this, but may wish to if you have multiple
        // Backbone views attached to the same DOM element.
        undelegateEvents: function () {
            if (this.$el) this.$el.off('.delegateEvents' + this.cid);
            return this;
        },

        // A finer-grained `undelegateEvents` for removing a single delegated event.
        // `selector` and `listener` are both optional.
        undelegate: function (eventName, selector, listener) {
            this.$el.off(eventName + '.delegateEvents' + this.cid, selector, listener);
            return this;
        },

        // Produces a DOM element to be assigned to your view. Exposed for
        // subclasses using an alternative DOM manipulation API.
        _createElement: function (tagName) {
            return document.createElement(tagName);
        },

        // Ensure that the View has a DOM element to render into.
        // If `this.el` is a string, pass it through `$()`, take the first
        // matching element, and re-assign it to `el`. Otherwise, create
        // an element from the `id`, `className` and `tagName` properties.
        _ensureElement: function () {
            if (!this.el) {
                var attrs = _.extend({}, _.result(this, 'attributes'));
                if (this.id) attrs.id = _.result(this, 'id');
                if (this.className) attrs['class'] = _.result(this, 'className');
                this.setElement(this._createElement(_.result(this, 'tagName')));
                this._setAttributes(attrs);
            } else {
                this.setElement(_.result(this, 'el'));
            }
        },

        // Set attributes from a hash on this view's element.  Exposed for
        // subclasses using an alternative DOM manipulation API.
        _setAttributes: function (attributes) {
            this.$el.attr(attributes);
        }
    });

    
    // ActionTypes
    var ActionTypes = function() {
        this.types = [];
    }

    _.extend(ActionTypes.prototype, {
        set: function(types) {
            var self = this;
            this.types = [];
            for(var index in types) {
                self.types.push({
                    NAME: index,
                    MODEL: types[index].MODEL
                })
            }
        },
        add: function(name, model) {
            this.types.push({
                NAME: name,
                MODEL: model
            })
        },
        get: function(name) {
            if(name === null)
                return null;
            return _.find(this.types, function(type) {
                return type.NAME === name;
            }).MODEL
        },
        remove: function(name) {
            // TODO
        }
    });

    ppmvc.ActionTypes = new ActionTypes();

    // ppmvc.Store
    var Store = function() {
        this.models = {};
    }

    _.extend(Store.prototype, Events, {
        /**
         * 静动态创建model对象 并放入models模型里
         * @param type 类型
         * @param cb 返回值
         * @param options 配置参数 如果有data代表外部数据导入，如果有url表示异步请求
         * @param method type:add 追加请求 key:关键值
         */
        load: function(type, cb, options,method) {
            var ntype = type;
            if(method) {
                if(method.type == "add") ntype = ntype+method.key;
            }
            if (typeof type === "string" && typeof cb === "function") {
                if (typeof options !== "undefined") {
                    this.once(ntype, cb);
                    if (options.hasOwnProperty('url')) {
                        this._asynLoad(type, cb, options,ntype);
                    } else if (options.hasOwnProperty('data')) {
                        this.models[type] = this._createModel(type, options['data']);
                        this.trigger(type, { "model": this.models[type] });
                    }
                }
            }
        },
        /**
         * 获取具体模型对象
         */
        getModel: function(name) {
            if (typeof name === "string" && this.models.hasOwnProperty(name)) {
                return this.models[name];
            } else {
                return null;
            }
        },
        /**
         * 创建不同的model
         * @param type 类型
         * @param data 数据内容
         * @return 返回model
         */
        _createModel: function(type, data) {
            var model;
        
            var ActionType = ppmvc.ActionTypes.get(type);
        
            if (ActionType) {
                model = new ActionType(data);
            } else {
                model = new Model(data);
            }
        
            return model;
        },
        /**
         * 异步请求远端数据
         * @param type 类型
         * @param cb 回调函数
         * @param options 参数
         */
        _asynLoad: function(type, cb, options,ntype) {
            var self = this;
            var lp = function() {
                var loadDeferred = $.Deferred();
                var loadPromise = loadDeferred.promise();
                ppmvc.ajax(options).done(function(data) {
                    loadDeferred.resolve(data);
                }).fail(function() {
                    loadDeferred.resolve({ 'errorCode': '500' });
                });
                return loadDeferred;
            }
            lp().then(function(data) {
                self.models[ntype] = self._createModel(type, data);
                self.trigger(ntype, { "model": self.models[ntype] })
            });
        }
    });

    ppmvc.Store = new Store();

    // ajax
    ppmvc.ajax = function() {
        if ($.ppXHR) {
            return ppmvc.$.ppXHR.JSONP.apply(ppmvc.$.ppXHR, arguments);
            // return ppmvc.$.ppXHR.JSONP(arguments);
        }
        return ppmvc.$.ajax.apply(ppmvc.$, arguments);
    };


    // 继承模块
    var extend = function (protoProps, classProps) {
        return inherits(this, protoProps, classProps);
    };

    var inherits = function (parent, protoProps, staticProps) {
        var child;

        // The constructor function for the new subclass is either defined by you
        // (the "constructor" property in your `extend` definition), or defaulted
        // by us to simply call the parent's constructor.
        if (protoProps && protoProps.hasOwnProperty('constructor')) {
            child = protoProps.constructor;
        } else {
            child = function () {
                parent.apply(this, arguments);
            };
        }

        // Inherit class (static) properties from parent.
        _.extend(child, parent);

        // Set the prototype chain to inherit from `parent`, without calling
        // `parent`'s constructor function.
        var ctor = function () { }
        ctor.prototype = parent.prototype;
        child.prototype = new ctor();

        // Add prototype properties (instance properties) to the subclass,
        // if supplied.
        if (protoProps) _.extend(child.prototype, protoProps);

        // Add static properties to the constructor function, if supplied.
        if (staticProps) _.extend(child, staticProps);

        // Correctly set child's `prototype.constructor`.
        child.prototype.constructor = child;

        // Set a convenience property in case the parent's prototype is needed later.
        child.__super__ = parent.prototype;

        return child;
    };

    // 添加继承模块
    Model.extend = View.extend = extend;

    return ppmvc;
});