        function parseSquare(str) {
            return str.charCodeAt(0) - "a".charCodeAt(0) + 8*(7 - str.charCodeAt(1) + "1".charCodeAt(0))
        }
 
        function __setv(k, v) {
            this[k] = v
            return this
        }
        function Piece(n, c, s) {
 
            this.name = n
            this.color = c
            this.specs = s
 
            this.setv = __setv
 
            this.xfen = function () {
                var glyph = this.name.toLowerCase() in __fairyHelper.override?
                    __fairyHelper.override[this.name.toLowerCase()]:
                    __fairyHelper.glyphs[this.name.toLowerCase()]
 
                if (this.color == 'w') {
                    glyph = glyph.toUpperCase()
                } else {
                    glyph = glyph.toLowerCase()
                }
 
                if (this.color == 'n') {
                    glyph = '!' + glyph
                }
 
                if (this.specs != '') {
                    glyph = 'b' + glyph
                }
 
                if (glyph.length > 1) {
                    glyph = '(' + glyph + ')'
                }
 
                return glyph
            }
 
            this.inverseColor = function() {
                if(this.color == 'w')
                    this.color = 'b'
                else if(this.color == 'b')
                    this.color = 'w'
            }
 
            this.asText = function() {
                var name = this.name;
                if(__fairyHelper.notation[name]) {
                    name = __fairyHelper.notation[name];
                }
                return (this.color == 'n'? 'n': '') + this.specs + name;
            }
 
        }
 
        function ParsePiece(xfen) {
            var c = "b"
            if(xfen.charAt(0) == "!") {
                c = "n";
                xfen = xfen.substring(1);
            } else if (xfen.toUpperCase() == xfen) {
                c = "w"
            }
 
            return new Piece(xfen.toUpperCase(), c, [])
        }
 
        function FairyHelper() {
            this.override = {};
            this.notation = {};
            this.glyphs = {
                '15':'s3', '16':'s3', '24':'s3', '25':'s3', '35':'s3', '36':'s3', '37':'s3', 'al':'b3', 'am':'a', 'an':'s1', 'ao':'s1',
                'ar':'b2', 'b':'b', 'b1':'o', 'b2':'o', 'b3':'o', 'be':'o', 'bh':'b2', 'bi':'o', 'bk':'s1', 'bl':'b3', 'bm':'o',
                'bn':'s2', 'bo':'o', 'bp':'p2', 'br':'o', 'bs':'p2', 'bt':'o', 'bu':'s1', 'bw':'o', 'c':'b1', 'ca':'s3', 'cg':'q1',
                'ch':'s3', 'cp':'p3', 'cr':'s3', 'ct':'o', 'cy':'o', 'da':'r1', 'db':'b1', 'dg':'q1', 'dk':'r1', 'do':'q3', 'dr':'o',
                'ds':'o', 'du':'p1', 'ea':'q3', 'eh':'q1', 'ek':'o', 'em':'r2', 'eq':'e', 'et':'o', 'f':'o', 'fe':'b3', 'fr':'o',
                'g':'q2', 'g2':'q1', 'g3':'q3', 'ge':'o', 'gf':'o', 'gh':'s1', 'gi':'s1', 'gl':'o', 'gn':'s1', 'gr':'o', 'gt':'o',
                'ha':'q3', 'k':'k', 'ka':'q3', 'kl':'q3', 'kh':'k2', 'kl':'q1', 'ko':'o', 'kp':'s2', 'l':'q1', 'lb':'b1', 'le':'q3',
                'lh':'o', 'li':'q3', 'ln':'s1', 'lr':'r1', 'ls':'f', 'm':'o', 'ma':'s1', 'mg':'o', 'mh':'o', 'ml':'o', 'mm':'o',
                'mo':'s3', 'mp':'p3', 'ms':'s3', 'n':'s2', 'na':'s3', 'nd':'b3', 'ne':'e', 'nh':'s3', 'nl':'s3', 'o':'o', 'oa':'s1',
                'ok':'o', 'or':'e1', 'p':'p', 'pa':'r3', 'po':'k3', 'pp':'p2', 'pr':'b2', 'q':'q', 'qe':'e', 'qf':'e', 'qn':'o',
                'qq':'o', 'r':'r', 'ra':'o', 'rb':'b3', 're':'r1', 'rf':'o', 'rh':'r2', 'rk':'o', 'rl':'r3', 'rm':'r1', 'rn':'f',
                'rp':'f', 'ro':'f', 'rr':'o', 'rt':'q1', 'rw':'o', 's':'s', 's1':'s2', 's2':'s2', 's3':'s2', 's4':'s2', 'sh':'o',
                'si':'q3', 'sk':'a', 'so':'o', 'sp':'p1', 'sq':'o', 'ss':'o', 'sw':'o', 'th':'o', 'tr':'r3', 'uu':'o', 'va':'b3',
                'wa':'o', 'we':'r2', 'wr':'o', 'z':'s3', 'zh':'o', 'zr':'s1', 'ze':'o', 'ms':'s3',
                'fa':'r1','se':'q1','sa':'s1','lo':'b1'
            };
            this.captureGlyph = "x";
            this.pprops = ['chameleon', 'jigger', 'kamikaze', 'paralysing', 'royal', 'volage', 'functionary', 'halfneutral', 'hurdlecolourchanging',
                'protean', 'magic', 'uncapturable'];
        }
 
 
        function Board() {
 
            this.add = function(piece, at) {
                if( (at > 63) || (at < 0) ) {
                    return;
                }
                this.board[at] = piece
            }
 
            this.drop = function(at) {
                this.add(null, at)
            }
 
            this.clear = function() {
                this.board = new Array(64);
                this.imitators = []
 
                for(i = 0; i < 64; i++) {
                    this.drop(i);
                }
            }
 
            this.move = function(from, to) {
                this.add(this.board[from], to)
                this.drop(from)
            }
 
            this.transform = function(method) {
                var tmp = new Board()
                for(var i = 0; i < 64; i++) {
                    if(this.board[i] != null) {
                        p = to_xy(i)
                        tmp.add(this.board[i], method(p.x, p.y))
                    }
                }
                this.board = tmp.board
            }
 
            // :)
            this.rotate = function(angle) {
                switch(angle) {
                    case 270:
                        this.rotate(90)
                    case 180:
                        this.rotate(90)
                    case 90:
                        this.transform( function(x, y) { return from_xy(y, 7 - x) } )
                }
            }
 
            this.shift = function(a, b) {
                pa = to_xy(a)
                pb = to_xy(b)
                this.transform( function(x, y) { return from_xy(x + pb.x - pa.x, y + pb.y - pa.y) })
            }
 
            this.mirror = function(a, b) {
                if(a == 56) { // a1 <--
                    if(b == 63) // --> h1
                        this.transform( function(x, y) { return from_xy(7 - x, y) })
                    else if (b == 7) // --> h8
                        this.transform( function(x, y) { return from_xy(y, x) })
                    else if (b == 0) // --> a8
                        this.transform( function(x, y) { return from_xy(x, 7 - y) })
                } else if ( (a == 63) && (b == 0)) { // h1 <--> a8
                    this.transform( function(x, y) { return from_xy(7 - y, 7 - x) })
                }
            }
 
            this.polishTwin = function(method) {
                for(var i = 0; i < 64; i++) {
                    if(this.board[i] != null) {
                        this.board[i].inverseColor()
                    }
                }
            }
 
            this.toFen = function() {
                var fen = ''; var blanks = 0;
                for(var i = 0; i < 64; i++) {
                    if( (i > 0) && (i % 8 == 0) ) {
                        if(blanks > 0)
                            fen += blanks;
                        fen += '/';
                        blanks = 0;
                    }
 
                    var f = '';
                    if(this.board[i] != null) f = this.board[i].xfen();
                    if(this.imitators.indexOf(i) != -1) f = '(!o)';
 
                    if(f != '') {
                        if(blanks > 0)
                            fen += blanks;
                        fen += f;
                        blanks = 0;
                    } else {
                        blanks++;
                    }
                }
                if(blanks > 0)
                    fen += blanks;
                return fen;
            }
 
            this.fromFen = function(fen) {
                this.clear()
                var i = 0;
                var j = 0;
                while((j < 64) && (i < fen.length)) {
                    if("12345678".indexOf(fen.charAt(i)) != -1) {
                        j = j + parseInt(fen.charAt(i))
                        i = i + 1
                    } else if('(' == fen.charAt(i)) {
                        idx = fen.indexOf(')', i);
                        if(idx != -1) {
                            this.add(ParsePiece(fen.substring(i+1, idx)), j)
                            j = j + 1
                            i = idx + 1
                        } else {
                            i = i + 1
                        }
                    } else if('/' == fen.charAt(i)) {
                        i = i + 1
                    } else {
                        this.add(ParsePiece(fen.charAt(i)), j)
                        j = j + 1;
                        i = i + 1;
                    }
                }
            }
 
            this.toAlgebraic = function() {
                var retval = {white: [], black: [], neutral: []}
                var cs = {w:"white", b:"black", n:"neutral"}
                for(var i = 0; i < 64; i++) {
                    if(this.board[i] != null) {
                        retval[cs[this.board[i].color]].push(this.board[i].name + algebraic(i))
                    }
                }
                return retval
            }
 
            this.fromPiecesClause = function(p) {
                this.clear()
                var lines = p.trim().toLowerCase().split("\n")
                for(var i = 0; i < lines.length; i++) {
                    var words = lines[i].trim().split(/\s+/)
                    if (['white', 'black', 'neutral'].indexOf(words[0]) == -1) {
                        continue
                    }
                    var color = words[0][0]
                    var specs = ''
                    var j = 1
                    while((j < words.length) && (__fairyHelper.pprops.indexOf(words[j]) != -1)) {
                        specs += words[j][0]
                        j = j + 1
                    }
 
                    var matches
                    while((j < words.length) && (matches = words[j].match(/([0-9a-z][0-9a-z]?)([a-h][1-8])+/))) {
                        name = matches[1].toUpperCase()
                        for(var k = 0; k < (words[j].length - name.length)/2; k++) {
                            var square = parseSquare(words[j].substr(name.length + k*2, 2))
                            if('i' == name.toLowerCase()) {
                                this.imitators.push(square)
                            } else {
                                this.add(new Piece(name, color, specs), square)
                            }
                        }
                        j = j + 1
                    }
                }
            }
 
            this.fromAlgebraic = function(algebraic) {
                for(color in algebraic) {
                    if (['white', 'black', 'neutral'].indexOf(color) == -1) {
                        continue;
                    }
                    for(var i = 0; i < algebraic[color].length; i++) {
                        var words = algebraic[color][i].split(/\s+/);
                        var specs = '';
                        for(var j = 0; j < words.length - 2; j++) {
                            if(__fairyHelper.pprops.indexOf(words[j]) != -1) {
                                specs += words[j][0];
                            }
                        }
                        if(matches = words[words.length - 1].toLowerCase().match(/([a-z][0-9a-z]?)([a-h][1-8])+/)) {
                            var name = matches[1].toUpperCase();
                            var square = parseSquare(matches[2]);
                            this.add(new Piece(name, color[0], specs), square)
                        }
 
                    }
                }
            }
 
            this.toPiecesClause = function(algebraic) {
                var retval = "";
                for(color in algebraic) {
                    for(var i = 0; i < algebraic[color].length; i++) {
                        retval += color + " " + algebraic[color][i] + "\n";
                    }
                }
                //console.log(retval);
                return retval;
            }
 
            this.xfen2Html = function(fen) {
 
                var b = new Array(64);
                for(var i = 0; i < 64; i++) {
                    b[i] = '';
                }
 
                var i = 0;
                var j = 0;
                while((j < 64) && (i < fen.length)) {
                    if("12345678".indexOf(fen.charAt(i)) != -1) {
                        j = j + parseInt(fen.charAt(i))
                        i = i + 1
                    } else if('(' == fen.charAt(i)) {
                        idx = fen.indexOf(')', i);
                        if(idx != -1) {
                            b[j] = fen.substring(i+1, idx)
                            j = j + 1
                            i = idx + 1
                        } else {
                            i = i + 1
                        }
                    } else if('/' == fen.charAt(i)) {
                        i = i + 1
                    } else {
                        b[j] = fen.charAt(i)
                        j = j + 1;
                        i = i + 1;
                    }
                }
 
                var retval = '';
                for(var i = 0; i < 8; i++) {
                    for(var j = 0; j < 8; j++) {
                        retval += '<a class="cp' + xfen2spritedecl(b[i*8+j], (i+j)%2) +'"></a>'
                    }
                }
                return retval;
 
 
            }
 
            this.toHtml = function() {
                var retval = '';
                for(var i = 0; i < 8; i++) {
                    for(var j = 0; j < 8; j++) {
                        var xfen = this.board[i*8+j] == null? '': this.board[i*8+j].xfen()
                        retval += '<a class="cp' + xfen2spritedecl(xfen, (i+j)%2) +'"></a>'
                    }
                }
                return retval;
            }
 
            this.btm = true  // black to move
 
            this.flip = function() {
                this.btm = !this.btm
            }
 
            this.getStm = function() {
                return this.btm? 'b': 'w'
            }
 
            this.setStm = function(c) {
                this.btm = (c == 'b')
            }
 
            this.serialize = function() {
                return JSON.stringify(this)
            }
 
            this.unserialize = function(s) {
                o = JSON.parse(s)
                for(var i = 0; i < 64; i++) {
                    if(o.board[i] != null) {
                        this.board[i] = new Piece(o.board[i].name, o.board[i].color, o.board[i].specs)
                    } else {
                        this.board[i] = null
                    }
                }
                this.btm = o.btm
                this.imitators = o.imitators
            }
 
            this.piecesCount = function() {
                var cnt = {w: 0, b: 0, n: 0};
                for(var i = 0; i < 64; i++) {
                    if(this.board[i] != null) {
                        cnt[this.board[i].color]++;
                    }
                }
                var pcs =  cnt.w + '+' + cnt.b
                if(cnt.n > 0) pcs = pcs + '+' + cnt.n
                return pcs
            }
 
 
            this.clear();
        }
 
 
 
        function xfen2spritedecl(xfen, color) {
            if('' == xfen)
                return  ['EQ', 'FQ'][color]
 
            sprite = {}
            matches = xfen.match(/^\(?(B?)(!?)([kqrbsnpeaofwdx])([1-7])?\)?$/i)
            if(matches) {
                sprite = {'glyph':matches[3].toLowerCase(), 'rot':matches[4], 'border':(matches[1] != '')}
 
                if(matches[2] != '') sprite.color = 'neutral'
                else if(sprite.glyph == matches[3]) sprite.color = 'black'
                else sprite.color = 'white'
 
                if(!sprite.rot) sprite.rot = 0;
 
            } else {
                sprite = {'glyph':'x', 'rot':0, 'color':'white', 'border':false}
            }
            if(sprite.glyph == 'x') sprite.color = 'white';
 
            rot4 = 'kqrbsnp'
            rot2 = 'e'
            rot1 = 'aofwd'
 
            baseGlyphs = {
                'k':[[0,0], [0,17]],
                'q':[[0,2], [0,18]],
                'r':[[0,4], [0,19]],
                'b':[[0,6], [0,20]],
                's':[[0,8], [0,21]],
                'n':[[0,8], [0,21]],
                'p':[[0,10], [0,22]],
                'e':[[0,14], [0,16]],
                'a':[[4,15], [4,15]],
                'o':[[0,15], [6,13]],
                'f':[[0,12], [0,12]],
                'w':[[4,12], [4,12]],
                'd':[[0,13], [0,13]],
                'x':[[4,13], [4,13]] }
            s = 0
 
            // color modifiers
            if(sprite.color == 'neutral') {
                s = baseGlyphs[sprite.glyph][1][0] + 8*baseGlyphs[sprite.glyph][1][1]
            } else if((sprite.color == 'white')) {
                s = baseGlyphs[sprite.glyph][0][0] + 8*baseGlyphs[sprite.glyph][0][1]
            } else {
                s = baseGlyphs[sprite.glyph][0][0] + 8*baseGlyphs[sprite.glyph][0][1] + 2
            }
 
            // rotation modifiers
            if(sprite.rot > 3) { // 45 deg are not yet supported
                sprite.rot = sprite.rot % 4
                if(0 == sprite.rot) sprite.rot = 1
            }
            if(-1 != rot4.indexOf(sprite.glyph)) {
                if(sprite.color == 'neutral') {
                    s += 2*sprite.rot
                } else {
                    s += 4*sprite.rot
                }
            } else if(-1 != rot2.indexOf(sprite.glyph)) {
                if(sprite.color == 'neutral') {
                    s += 2*(sprite.rot % 2)
                } else {
                    s += 4*(sprite.rot % 2)
                }
            } // and rot1 cant be rotated
 
            // bg modifier
            s += color
 
            ABC = 'ABCDEFGHIJKLMNOPQRSTUVW'
            classList = ABC.charAt(s % 8) + ABC.charAt(s / 8)
            if(sprite.border) classList += ' boxed'
            return classList
        }

        var __fairyHelper = new FairyHelper();
        var board = new Board();
 
        module.exports = {
            parseSquare,
            __setv,
            Piece,
            ParsePiece,
            FairyHelper,
            Board,
            xfen2spritedecl,
            __fairyHelper,
            board

        }
    