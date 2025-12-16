//=============================================================================
// KOFFIN_InBattleStatus
// Version: 1.1
//=============================================================================
/*:
 * @plugindesc Adds a CTRL-hold actor info window during actor command selection
 * @author KoffinKrypt
 * 
 * @help
 * This plugin adds a detailed actor info window that appears when holding
 * CTRL during actor command selection in battles.
 * 
 * Features:
 * - Shows stats, equipment, and states in a compact format
 * - States display with icons, names, and descriptions
 * - Blacklist system using <HideInStatus> notetag
 * - Only appears when CTRL is held during command selection
 * 
 * State Descriptions:
 * - Each state shows a auto-generated description below its name
 * - You can set custom descriptions via <Desc:text> notetag
 * - You can override icons via <StatusIcon:id> notetag (system/Iconset.png)
 * - Auto-wrapping with guaranteed 2-line space
 * 
 * Usage:
 * During battle, when selecting an actor's action (Attack/Skill/Item),
 * hold CTRL to show the current actor's detailed information.
 * 
 *
 */

(function() {
    'use strict';
    
    // parameters
    var windowWidth = 480;
    var windowHeight = 300;
    var windowX = 240;
    var windowY = 100;
    var slideSpeed = 15;
    var bgOpacity = 255;
    
    // Store original functions
    var _Scene_Battle_create = Scene_Battle.prototype.create;
    var _Scene_Battle_update = Scene_Battle.prototype.update;
    var _Scene_Battle_startActorCommandSelection = Scene_Battle.prototype.startActorCommandSelection;
    
    //=============================================================================
    // ** Helper Functions for State Descriptions
    //=============================================================================
    
    // Check if state should be hidden in menu
    function isStateHiddenInMenu(state) {
        if (!state) return false;
        return state.note && state.note.match(/<HideInStatus>/i);
    }
    
    // Convert rate to display string
    function convertRateString(rate) {
        if (rate === 0) return "";
        var rateDisplay = (rate * 100) + "% RATE";
        if (rate > 0) rateDisplay = "+" + rateDisplay;
        return rateDisplay + " ";
    }
    
    // Convert turns to display string
    function convertTurnString(turns) {
        if (turns === 0) return "";
        if (turns > 0) return "" + turns + " TURNS";
        return turns + " TURNS";
    }
    
    // Convert trait effect to display string
    function convertTraitEffect(trait) {
        let value = trait.value;
        let type = trait.code;
        
        let effectText = "";
        
        // PARAM traits (stats)
        if (type === Game_BattlerBase.TRAIT_PARAM) {
            let paramNames = ["HP", "MP", "ATK", "DEF", "MAT", "MDF", "AGI", "LUK"];
            if (trait.dataId < paramNames.length) {
                let paramName = paramNames[trait.dataId];
                let percentageChange = Math.round((value - 1) * 100);
                if (percentageChange !== 0) {
                    effectText = `${percentageChange > 0 ? "+" : ""}${percentageChange}% ${paramName}`;
                }
            }
        }
        // XPARAM traits (hit, eva, regen, etc.)
        else if (type === Game_BattlerBase.TRAIT_XPARAM) {
            let paramNames = ["HIT", "EVA", "CRI", "CEV", "MEV", "MRF", "CNT", "HRG", "MRG", "TRG"];
            if (trait.dataId < paramNames.length) {
                let paramName = paramNames[trait.dataId];
                let percentageChange = Math.round(value * 100);
                if (percentageChange !== 0) {
                    effectText = `${percentageChange > 0 ? "+" : ""}${percentageChange}% ${paramName}`;
                }
            }
        }
        // SPARAM traits (elements, states)
        else if (type === Game_BattlerBase.TRAIT_SPARAM) {
            // Element rate
            if (trait.dataId === 0) {
                let elementId = trait.value;
                let percentageChange = Math.round((elementId - 1) * 100);
                if (percentageChange !== 0) {
                    effectText = `${percentageChange > 0 ? "+" : ""}${percentageChange}% ELEMENT`;
                }
            }
        }
        
        return effectText;
    }
    
    // Get state description text
    function getStateDescription(state, actor, stateId) {
        // Check for custom description in notetag
        var descMatch = state.note.match(/<Desc:\s*(.+?)>/i);
        if (descMatch) {
            return descMatch[1];
        }
        
        // Generate description from traits
        var descriptions = [];
        
        // Add trait effects
        state.traits.forEach(function(trait) {
            var effectText = convertTraitEffect(trait);
            if (effectText) {
                descriptions.push(effectText);
            }
        });
        
        // Add state rate if applicable
        if (state.speed > 0) {
            descriptions.push(convertRateString(state.speed / 100));
        }
        
        // Add auto-removal timing (only mention if it has auto-removal)
        if (state.autoRemovalTiming > 0) {
            descriptions.push("");
        }
        
        // Add removal by damage
        if (state.removeByDamage) {
            descriptions.push("");
        }
        
        // Default if no traits
        if (descriptions.length === 0) {
            descriptions.push("NO EFFECTS");
        }
        
        return descriptions.join(" ");
    }
    
    // Get custom icon from notetag
    function getStateIconIndex(state) {
        var iconMatch = state.note.match(/<StatusIcon:\s*(\d+)>/i);
        if (iconMatch) {
            return parseInt(iconMatch[1]);
        }
        return state.iconIndex;
    }
    
    //=============================================================================
    // ** Window_ActorInfo
    //-----------------------------------------------------------------------------
    // Window that shows detailed actor info when holding CTRL
    //=============================================================================
    function Window_ActorInfo() { this.initialize.apply(this, arguments); }
    Window_ActorInfo.prototype = Object.create(Window_Base.prototype);
    Window_ActorInfo.prototype.constructor = Window_ActorInfo;
    
//=============================================================================
// * Initialize
//=============================================================================
Window_ActorInfo.prototype.initialize = function() {
    Window_Base.prototype.initialize.call(this, windowX, Graphics.boxHeight, windowWidth, windowHeight);
    
    this._actor = null;
    this._visible = false;
    this._targetY = Graphics.boxHeight; // Start off-screen bottom
    this._slideSpeed = slideSpeed;
    this._stateColumns = 2;
    this._isActive = false;
    this._lastStateCount = 0;
    
    this.createBackground();
};
    
    //=============================================================================
    // * Create Background
    //=============================================================================
    Window_ActorInfo.prototype.createBackground = function() {
        this._backSprite = new Sprite();
        this._backSprite.bitmap = new Bitmap(windowWidth, windowHeight);
        this._backSprite.bitmap.fillAll('rgba(0, 0, 0, ' + (bgOpacity / 255) + ')');
        this.addChildToBack(this._backSprite);
        
        var border = new Sprite();
        border.bitmap = new Bitmap(windowWidth, windowHeight);
        
        border.bitmap.fillRect(0, 0, windowWidth, 4, 'rgba(255, 255, 255, 1)');
        border.bitmap.fillRect(0, windowHeight - 4, windowWidth, 4, 'rgba(255, 255, 255, 1)');
        border.bitmap.fillRect(0, 0, 4, windowHeight, 'rgba(255, 255, 255, 1)');
        border.bitmap.fillRect(windowWidth - 4, 0, 4, windowHeight, 'rgba(255, 255, 255, 1)');
        
        this.addChild(border);
    };
    
    //=============================================================================
    // * Filter States - UPDATED to use <HideInStatus> notetag
    //=============================================================================
    Window_ActorInfo.prototype.filterStates = function(states) {
        if (!states) return [];
        return states.filter(function(state) {
            return state && !isStateHiddenInMenu(state);
        });
    };
    
    //=============================================================================
    // * Get Filtered State Count
    //=============================================================================
    Window_ActorInfo.prototype.getFilteredStateCount = function(actor) {
        if (!actor) return 0;
        return this.filterStates(actor.states()).length;
    };
    
    //=============================================================================
    // * Set Actor
    //=============================================================================
    Window_ActorInfo.prototype.setActor = function(actor) {
        if (this._actor !== actor) {
            this._actor = actor;
            this._lastStateCount = -1;
            this.refresh();
        }
    };
    
//=============================================================================
// * Show Window
//=============================================================================
Window_ActorInfo.prototype.showWindow = function() {
    if (!this._isActive) return;
    this._visible = true;
    this._targetY = windowY; // Slide up to specified Y position
};

//=============================================================================
// * Hide Window
//=============================================================================
Window_ActorInfo.prototype.hideWindow = function() {
    this._visible = false;
    this._targetY = Graphics.boxHeight; // Slide down off-screen
};
    
    //=============================================================================
    // * Activate
    //=============================================================================
    Window_ActorInfo.prototype.activate = function() {
        this._isActive = true;
    };
    
    //=============================================================================
    // * Deactivate
    //=============================================================================
    Window_ActorInfo.prototype.deactivate = function() {
        this._isActive = false;
        this.hideWindow();
    };
    
//=============================================================================
// * Update
//=============================================================================
Window_ActorInfo.prototype.update = function() {
    Window_Base.prototype.update.call(this);
    
    // Smooth slide animation (vertical now)
    if (Math.abs(this.y - this._targetY) > 0.5) {
        var speed = this._slideSpeed;
        this.y = (this.y * (speed - 1) + this._targetY) / speed;
    }
    
    // Update content if needed
    if (this._actor && this._visible) {
        this.refreshIfNeeded();
    }
};

    //=============================================================================
    // * Refresh If Needed
    //=============================================================================
    Window_ActorInfo.prototype.refreshIfNeeded = function() {
        var currentStateCount = this.getFilteredStateCount(this._actor);
        if (currentStateCount !== this._lastStateCount) {
            this._lastStateCount = currentStateCount;
            this.refresh();
        }
    };
    
    //=============================================================================
    // * Refresh
    //=============================================================================
    Window_ActorInfo.prototype.refresh = function() {
        if (!this._actor) return;
        
        this.contents.clear();
        
        this.drawHeader();
        this.drawStatsSection();
        this.drawStatesSection();
    };
    
    //=============================================================================
    // * Get Base Stat
    //=============================================================================
    Window_ActorInfo.prototype.getBaseStat = function(actor, paramId) {
        return actor.paramBase(paramId) + actor.paramPlus(paramId);
    };
    
    //=============================================================================
    // * Convert Magic Param Rate
    //=============================================================================
    Window_ActorInfo.prototype.convertMagicParamRate = function(rawRate) {
        if (rawRate > 1) {
            if (Math.abs(rawRate - 4) < 0.001) return 1.15;
            else if (Math.abs(rawRate - 6) < 0.001) return 1.30;
            else if (Math.abs(rawRate - 8) < 0.001) return 1.50;
        } else if (rawRate < 1) {
            if (Math.abs(rawRate - 0.5) < 0.001) return 0.85;
            else if (Math.abs(rawRate - 0.25) < 0.001) return 0.70;
            else if (Math.abs(rawRate - 0.125) < 0.001) return 0.50;
        }
        return 1;
    };
    
    //=============================================================================
    // * Draw Header
    //=============================================================================
    Window_ActorInfo.prototype.drawHeader = function() {
        var actor = this._actor;
        if (!actor) return;
        
        var x = 8;
        var y = 8;
        
        this.changeTextColor(this.textColor(0));
        this.contents.fontSize = 24;
        this.contents.fontBold = true;
        this.contents.drawText(actor.name(), x, y, this.contentsWidth() - 16, 28);
        this.contents.fontBold = false;
        
        x += 124;
        
        var equips = actor.equips();
        var weapon = equips[0] ? equips[0].name : "NONE";
        var charm = equips[1] ? equips[1].name : "NONE";
        
        this.contents.fontSize = 20;
        this.changeTextColor(this.textColor(13));
        this.contents.drawText("WEAPON: ", x, y, 100, 22);
        
        this.changeTextColor(this.textColor(0));
        this.contents.drawText(weapon, x + 60, y, 85, 22);
        
        this.changeTextColor(this.textColor(13));
        this.contents.drawText("CHARM: ", x + 150, y, 80, 22);
        
        this.changeTextColor(this.textColor(0));
        this.contents.drawText(charm, x + 205, y, 120, 22);
    };
    
//=============================================================================
// * Draw Stats Section
//=============================================================================
Window_ActorInfo.prototype.drawStatsSection = function() {
    var actor = this._actor;
    if (!actor) return;
    
    var x = 20;
    var y = 30;
    
    var magicAtkRate = actor.paramRate(4);
    var magicDefRate = actor.paramRate(5);
    
    var displayedAtk = Math.round(actor.atk * this.convertMagicParamRate(magicAtkRate));
    var displayedDef = Math.round(actor.def * this.convertMagicParamRate(magicDefRate));
    
    var baseAtk = this.getBaseStat(actor, 2);
    var baseDef = this.getBaseStat(actor, 3);
    var baseAgi = this.getBaseStat(actor, 6);
    var baseLuk = this.getBaseStat(actor, 7);
    
    var fontSize = actor.eva > 0 ? 22 : 22;
    this.contents.fontSize = fontSize;
    
    var formatStat = function(label, stat, base) {
        var color = stat < base ? 2 : stat > base ? 3 : 0;
        var arrow = stat < base ? "↓" : stat > base ? "↑" : "";
        return {label: label, value: stat, color: color, arrow: arrow};
    };
    
    var formatRateStat = function(label, rate) {
        return {label: label, value: Math.round(rate * 100) + "%", color: 0, arrow: ""};
    };
    
    var line1Stats = [
		formatStat("LV: ", actor.level),
        formatStat("ATK: ", actor.atk, baseAtk),
        formatStat("DEF: ", actor.def, baseDef),
        formatStat("SPD: ", actor.agi, baseAgi),
        formatStat("LUK: ", actor.luk, baseLuk)
    ];
    
    var statX = x;
    var statWidth = 85;
    for (var i = 0; i < line1Stats.length; i++) {
        var stat = line1Stats[i];
        
        // Draw label
        this.changeTextColor(this.textColor(0));
        this.contents.drawText(stat.label, statX, y, 40, fontSize + 4);
        
        // Draw value with color and arrow
        this.changeTextColor(this.textColor(stat.color));
        var valueText = stat.value.toString();
        if (stat.arrow) {
            valueText = valueText + " " + stat.arrow;
        }
        this.contents.drawText(valueText, statX + 35, y, 60, fontSize + 4);
        
        statX += statWidth;
    }
    
    y += fontSize + 4;
    
    // Second line: HIT, EVA
    var line2Stats = [
        formatRateStat("HIT RATE: ", actor.hit)
    ];
    
    if (actor.eva > 0) {
        line2Stats.push(formatRateStat("EVASION: ", actor.eva));
    }
        if (actor.eva > 0) {
    statX = x+75;
		} else {
	statX = x+125
	}
    statWidth = 125;
    for (var i = 0; i < line2Stats.length; i++) {
        var stat = line2Stats[i];
        
        // Draw label
        this.changeTextColor(this.textColor(0));
        this.contents.drawText(stat.label, statX, y, 90, fontSize + 4);
        
        // Draw value
        this.changeTextColor(this.textColor(0));
        this.contents.drawText(stat.value, statX + 85, y, 60, fontSize + 4);
        
        statX += statWidth;
    }
    
    this.resetFontSettings();
};
    
    //=============================================================================
    // * Draw States Section
    //=============================================================================
    Window_ActorInfo.prototype.drawStatesSection = function() {
        var actor = this._actor;
        if (!actor) return;
        
        var x = 8;
        var y = 85;
        
        var states = this.filterStates(actor.states());
        var stateCount = states.length;
        
        if (stateCount === 0) {
		this.contents.fontSize = 24;
        this.changeTextColor(this.textColor(0));
        this.contents.drawText("NO EFFECTS ACTIVE", x + 150, y + 75, this.contentsWidth() - 16, 22);
        y += 24;
            return;
        }
        
        this.contents.fontSize = 24;
        this.changeTextColor(this.textColor(0));
        this.contents.drawText("STATES (" + stateCount + ")", x + 175, y - 2, this.contentsWidth() - 16, 22);
        y += 26;
        
        // Adjust columns based on state count
        this._stateColumns = stateCount > 9 ? 4 : stateCount > 6 ? 3 : 2;
        var colWidth = Math.floor((this.contentsWidth() - 16) / this._stateColumns);
        var maxRows = Math.ceil(stateCount / this._stateColumns);
        
        // Increase row height to accommodate 2 lines of description
        var rowHeight = 60;
        
        for (var i = 0; i < stateCount; i++) {
            var state = states[i];
            var col = i % this._stateColumns;
            var row = Math.floor(i / this._stateColumns);
            
            var stateX = x + (col * colWidth);
            var stateY = y + (row * rowHeight);
            
            this.drawState(state, stateX, stateY, colWidth - 8);
        }
    };
    
//=============================================================================
// * Draw State - ENHANCED VERSION
//=============================================================================
Window_ActorInfo.prototype.drawState = function(state, x, y, width) {
    if (!state) return;
    
    var iconSize = 32;
    
    // Draw custom icon if specified
    var iconIndex = getStateIconIndex(state);
    this.drawIcon(iconIndex, x, y);
    
    // Get turns remaining only if state has auto-removal
    var turnText = "";
    var stateId = state.id;
    if (this._actor.isStateAffected(stateId) && state.autoRemovalTiming > 0) {
        var turns = this._actor.stateTurns(stateId) || 0;
        if (turns > 0) {
            turnText = " (" + turns + " TURNS)";
        }
    }
    
    // Draw state name with turns
    this.changeTextColor(this.textColor(0));
    this.contents.fontSize = this._stateColumns > 2 ? 16 : 18;
    this.contents.fontBold = true;
    var nameText = state.name + turnText;
    this.contents.drawText(nameText, x + iconSize + 4, y, width - iconSize - 4, 18);
    this.contents.fontBold = false;
    
    // Get state description (without turns now)
    var description = getStateDescription(state, this._actor, state.id);
    
    // Draw description with text wrapping (guaranteed 2 lines)
    if (description) {
        this.contents.fontSize = this._stateColumns > 2 ? 14 : 16;
        this.changeTextColor(this.textColor(0));
        
        // Simple text wrapping for 3 lines
    var words = description.split(' ');
    var lines = [];
    var currentLine = '';
    var maxWidth = width - iconSize - 8;
    
    for (var w = 0; w < words.length; w++) {
        var testLine = currentLine + (currentLine ? ' ' : '') + words[w];
        if (this.contents.measureTextWidth(testLine) > maxWidth) {
            lines.push(currentLine);
            currentLine = words[w];
            if (lines.length >= 3) break; // Limit to 3 lines now
        } else {
            currentLine = testLine;
        }
    }
    
    if (currentLine && lines.length < 3) {
        lines.push(currentLine);
    }
    
    // Draw the lines
    var lineY = y + 15;
    var lineHeight = 12;
    
    for (var l = 0; l < Math.min(lines.length, 3); l++) {
        this.contents.drawText(lines[l], x + iconSize + 4, lineY, maxWidth, lineHeight);
        lineY += lineHeight;
    }
    
    // Removed the ellipsis logic - just let it cut off naturally
}
    
    
    this.changeTextColor(this.textColor(0));
};
    
    //=============================================================================
    // * Contents Width
    //=============================================================================
    Window_ActorInfo.prototype.contentsWidth = function() {
        return this.width - this.standardPadding() * 2;
    };
    
    //=============================================================================
    // * Contents Height
    //=============================================================================
    Window_ActorInfo.prototype.contentsHeight = function() {
        return this.height - this.standardPadding() * 2;
    };
    
    //=============================================================================
    // * Standard Padding
    //=============================================================================
    Window_ActorInfo.prototype.standardPadding = function() {
        return 8;
    };
    
    //=============================================================================
    // ** Scene_Battle Modifications
    //=============================================================================
    
    //=============================================================================
    // * Create
    //=============================================================================
    Scene_Battle.prototype.create = function() {
        _Scene_Battle_create.call(this);
        this.createActorInfoWindow();
    };
    
    //=============================================================================
    // * Create Actor Info Window
    //=============================================================================
    Scene_Battle.prototype.createActorInfoWindow = function() {
        this._actorInfoWindow = new Window_ActorInfo();
        this.addChild(this._actorInfoWindow);
        this._actorInfoWindow.hideWindow();
    };
    
    //=============================================================================
    // * Update
    //=============================================================================
    Scene_Battle.prototype.update = function() {
        _Scene_Battle_update.call(this);
        
        if (this._actorCommandWindow && this._actorCommandWindow.active) {
            var actor = BattleManager.actor();
            if (actor) {
                this._actorInfoWindow.setActor(actor);
                this._actorInfoWindow.activate();
                
                if (Input.isPressed('control')) {
                    this._actorInfoWindow.showWindow();
                } else {
                    this._actorInfoWindow.hideWindow();
                }
            }
        } else {
            this._actorInfoWindow.deactivate();
        }
        
        this._actorInfoWindow.update();
    };
    
    //=============================================================================
    // * Start Actor Command Selection
    //=============================================================================
    Scene_Battle.prototype.startActorCommandSelection = function() {
        _Scene_Battle_startActorCommandSelection.call(this);
        
        var actor = BattleManager.actor();
        if (actor) {
            this._actorInfoWindow.setActor(actor);
            this._actorInfoWindow.activate();
        }
    };
    
    //=============================================================================
    // Plugin Load Message
    //=============================================================================
    console.log('TDS_OmoriActorInfoWindow v1.3 loaded successfully!');
    console.log('Hold CTRL during actor command selection to show detailed actor info.');
    console.log('States with <HideInStatus> notetag will be hidden from display.');
    
})();