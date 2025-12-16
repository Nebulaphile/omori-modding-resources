/*:
 * @plugindesc Fixes target rate not working using stupid ass YEP_BattleAICore
 * @author KoffinKrypt
 */




// Replace the existing setRandomTarget method with this shit
AIManager.setRandomTarget = function(group) {
    // If no group members, return early
    if (group.length <= 0) return;
    
    // Calculate total weight based on target rates
    var totalWeight = 0;
    var weights = [];
    
    for (var i = 0; i < group.length; ++i) {
        var target = group[i];
        var weight = target.tgr || 1.0; // Use target rate, default to 1.0 if undefined
        weights.push(weight);
        totalWeight += weight;
    }
    
    // Select target based on weighted probability
    var randomValue = Math.random() * totalWeight;
    var weightSum = 0;
    
    for (var i = 0; i < group.length; ++i) {
        weightSum += weights[i];
        if (randomValue <= weightSum) {
            this.action().setTarget(group[i].index());
            return;
        }
    }
    
    // Fallback to first target if something went wrong
    this.action().setTarget(group[0].index());
};