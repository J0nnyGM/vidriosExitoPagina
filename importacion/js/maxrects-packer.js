(function(global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.MaxRectsPacker = {}));
}(this, (function(exports) {
    'use strict';

    var t = function() {
        function t(t, i, s, e) {
            void 0 === s && (s = 0), this.x = t, this.y = i, this.width = s, this.height = e
        }
        return t.prototype.toString = function() {
            return "[Rectangle (x=" + this.x + ", y=" + this.y + ", width=" + this.width + ", height=" + this.height + ")]"
        }, t
    }();
    var i = function() {
        function i(s, e, h, o) {
            void 0 === h && (h = 0), this.maxWidth = 0, this.maxHeight = 0, this.padding = 0, this.rects = [], this.freeRects = [], this.bins = [], this.options = {
                smart: !0,
                pot: !0,
                square: !0,
                allowRotation: !1,
                tag: !1,
                border: 0
            }, s && e && (t.call(this, 0, 0, s, e), this.maxWidth = s, this.maxHeight = e), this.padding = h || 0, o && this.setOptions(o)
        }
        return i.prototype = Object.create(t.prototype), i.prototype.setOptions = function(t) {
            for (var i in this.options) this.options.hasOwnProperty(i) && t.hasOwnProperty(i) && (this.options[i] = t[i])
        }, i.prototype.add = function(t, i, s) {
            if (t instanceof Array) return this.addArray(t);
            var e = new MaxRectsPacker.Rectangle(0, 0, t, i);
            return s && (e.data = s), this.rects.push(e), e
        }, i.prototype.addArray = function(t) {
            for (var i = 0, s = t.length; i < s; i++) {
                var e = t[i];
                this.rects.push(e)
            }
            return this.rects
        }, i.prototype.repack = function() {
            var t = this;
            if (0 === this.rects.length) return !1;
            this.bins.forEach(function(i) {
                i.rects.forEach(function(i) {
                    i.x = 0, i.y = 0, t.rects.push(i)
                })
            }), this.bins.splice(0), this.rects.forEach(function(t) {
                t.x = 0, t.y = 0
            }), this.next = void 0;
            var i = this.rects;
            return this.rects = [], this.addArray(i), !0
        }, i.prototype.next = function() {
            if (this.rects.length > 0) {
                this.bins.push(new MaxRectsPacker.Bin(this.maxWidth, this.maxHeight, this.padding, this.options));
                var t = this.bins[this.bins.length - 1];
                t.addArray(this.rects), this.rects = t.rects, this.bins[this.bins.length - 1].rects.length > 0
            }
            return this.bins.length > 0 ? this.bins[this.bins.length - 1] : void 0
        }, i.prototype.reset = function() {
            this.rects = [], this.bins = [], this.freeRects = []
        }, Object.defineProperty(i.prototype, "width", {
            get: function() {
                for (var t = 0, i = 0, s = this.bins.length; i < s; i++) {
                    var e = this.bins[i];
                    t = Math.max(t, e.width)
                }
                return t
            },
            enumerable: !0,
            configurable: !0
        }), Object.defineProperty(i.prototype, "height", {
            get: function() {
                for (var t = 0, i = 0, s = this.bins.length; i < s; i++) {
                    var e = this.bins[i];
                    t = Math.max(t, e.height)
                }
                return t
            },
            enumerable: !0,
            configurable: !0
        }), i
    }();
    var s = function() {
        function s(e, h, o, n) {
            i.call(this, e, h, o, n), this._score1 = 0, this._score2 = 0, this._width = 0, this._height = 0, this.freeRects.push(new t(0, 0, e, h)), this._allowRotation = this.options.allowRotation
        }
        return s.prototype = Object.create(i.prototype), s.prototype.add = function(t, s, e) {
            if (t instanceof Array) return this.addArray(t);
            var h = new MaxRectsPacker.Rectangle(0, 0, t, s);
            return e && (h.data = e), this.rects.push(h), h
        }, s.prototype.addArray = function(t) {
            for (var i = t.slice(), s = 0; i.length > 0;) {
                for (var e = 0, h = null, o = -1, n = 0; n < i.length; n++) {
                    var r = i[n];
                    if (this.findPositionForNewNode(r.width, r.height, e, h)) {
                        i.splice(n, 1), n--, this.placeRectangle(r), s++
                    } else e = 0, h = null, o = -1
                }
                this.rects.length = s
            }
            return t
        }, s.prototype.findPositionForNewNode = function(t, i, s, e) {
            var h, o, n = new MaxRectsPacker.Rectangle;
            for (s = Number.MAX_VALUE, o = 0; o < this.freeRects.length; o++) {
                var r = this.freeRects[o];
                if (r.width >= t && r.height >= i) {
                    var a = this.score(r, t, i);
                    a < s && (s = a, n.x = r.x, n.y = r.y, n.width = t, n.height = i, h = !1)
                }
                if (this._allowRotation && r.width >= i && r.height >= t) {
                    var c = this.score(r, i, t);
                    c < s && (s = a, n.x = r.x, n.y = r.y, n.width = i, n.height = t, h = !0)
                }
            }
            return s !== Number.MAX_VALUE && (e = n, e.rot = h, e)
        }, s.prototype.placeRectangle = function(t) {
            for (var i = 0; i < this.freeRects.length; i++) {
                var s = this.freeRects[i];
                if (this.splitFreeNode(s, t)) {
                    this.freeRects.splice(i, 1), i--
                }
            }
            this.pruneFreeList(), this.rects.push(t)
        }, s.prototype.score = function(t, i, s) {
            return 0
        }, s.prototype.splitFreeNode = function(i, s) {
            return !i.collides(s) && (i.x < s.x + s.width && i.x + i.width > s.x && i.y < s.y + s.height && i.y + i.height > s.y && this.splitFreeNode(new t(i.x, i.y, i.width, s.y - i.y), s), this.splitFreeNode(new t(i.x, s.y + s.height, i.width, i.y + i.height - (s.y + s.height)), s), this.splitFreeNode(new t(i.x, i.y, s.x - i.x, i.height), s), this.splitFreeNode(new t(s.x + s.width, i.y, i.y + i.width - (s.x + s.width), i.height), s), !0)
        }, s.prototype.pruneFreeList = function() {
            for (var t = 0; t < this.freeRects.length; t++)
                for (var i = t + 1; i < this.freeRects.length; i++) {
                    var s = this.freeRects[t],
                        e = this.freeRects[i];
                    e.contains(s) ? (this.freeRects.splice(t, 1), t--) : e.contains(s) && (this.freeRects.splice(i, 1), i--)
                }
        }, s
    }();
    exports.Bin = s, exports.MaxRectsPacker = i, exports.Rectangle = t, Object.defineProperty(exports, "__esModule", {
        value: !0
    })
})));