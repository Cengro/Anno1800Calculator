products = new Map();
assetsMap = new Map();
view = {
    populationLevels: [],
    factories: [],
    categories: [],
    workforce: [],
    buildingMaterialsNeeds: [],
    settings: {
        language: ko.observable(navigator.language.startsWith("de") ? "german" : "english")
    },
    texts: {}
};


class NamedElement {
    constructor(config) {
        $.extend(this, config);
        this.locaText = this.locaText || {}
        this.name = ko.computed(() => {

            let text = this.locaText[view.settings.language()];
            if (text)
                return text;

            text = this.locaText["english"];
            return text ? text : config.name;
        })
    }
}

class Option extends NamedElement {
    constructor(config) {
        super(config);
        this.checked = ko.observable(false);
        this.visible = !!config;
    }
}

class Factory extends NamedElement {

    getInputs() {
        return this.inputs || [];
    }

    getOutputs() {
        return this.outputs || [];
    }

    referenceProducts() {
        this.getInputs().forEach(i => i.product = assetsMap.get(i.Product));
        this.getOutputs().forEach(i => i.product = assetsMap.get(i.Product));
    }

    getProduct() {
        return this.getOutputs()[0].product;
    }

    getWorkforceDemand() {
        for (let m of this.maintenances) {
            let a = assetsMap.get(m.Product);
            if (a instanceof Workforce)
                return new WorkforceDemand($.extend({ factory: this, workforce: a }, m));
        }
    }
}

class Product extends NamedElement {
    constructor(config) {
        super(config);


        this.amount = ko.observable(0);
        this.percentBoost = ko.observable(100);
        this.boost = ko.computed(() => parseInt(this.percentBoost()) / 100);
        this.demands = [];
        if (this.producer) {
            this.factory = assetsMap.get(this.producer);
            if (this.guid === 1010226) { // distinguish mine and kiln as producer
                this.charcoalFactory = assetsMap.get(1010298);
                this.coalFactory = assetsMap.get(1010304);
                this.buildings = ko.computed(() => {
                    let factory = view.settings.useCharcoal.checked() ? this.charcoalFactory : this.coalFactory;
                    return parseFloat(this.amount()) / factory.tpmin / this.boost();
                });
                this.workforceDemandCoal = this.coalFactory.getWorkforceDemand();
                this.workforceDemandCharcoal = this.charcoalFactory.getWorkforceDemand();
                let updateWorkforce = val => {
                    let useCharcoal = !!view.settings.useCharcoal.checked();
                    this.workforceDemandCharcoal.updateAmount(val * useCharcoal);
                    this.workforceDemandCoal.updateAmount(val * !useCharcoal);
                };
                this.buildings.subscribe(updateWorkforce);
                view.settings.useCharcoal.checked.subscribe(() => updateWorkforce(this.buildings()));
            } else if (this.guid === 1010242) { // distinguish marquetry producer in old and new world
                let factoryTpmin = this.factory.tpmin;
                this.buildings = ko.computed(() => parseFloat(this.amount()) / factoryTpmin / this.boost());
                this.workforceDemandOld = this.factory.getWorkforceDemand();
                this.workforceDemandNew = new WorkforceDemand({ workforce: assetsMap.get(1010117), Amount: 150, Product: 1010117, factory: this.factory }); 
                let updateWorkforce = val => {
                    let oldWorldMarquetry = !!view.settings.oldWorldMarquetry.checked()
                    this.workforceDemandOld.updateAmount(val * oldWorldMarquetry)
                    this.workforceDemandNew.updateAmount(val * !oldWorldMarquetry)
                };
                this.buildings.subscribe(updateWorkforce);
                view.settings.oldWorldMarquetry.checked.subscribe(() => updateWorkforce(this.buildings()));
            } else {
                let factoryTpmin = this.factory.tpmin;
                this.buildings = ko.computed(() => parseFloat(this.amount()) / factoryTpmin / this.boost());
                this.workforceDemand = this.factory.getWorkforceDemand();
                this.buildings.subscribe(val => this.workforceDemand.updateAmount(val));
            }
        }
    }

    updateAmount() {
        var sum = 0;
        this.demands.forEach(d => sum += d.amount());
        this.amount(sum);
    }

    getInputs() {
        if (!this.producer) return [];
        return assetsMap.get(this.producer).getInputs();
    }

    getOutputs() {
        if (!this.producer) return [];
        return assetsMap.get(this.producer).getOutputs();
    }

    add(demand) {
        this.demands.push(demand);
    }

    incrementBuildings() {
        if (this.buildings() <= 0 || parseInt(this.percentBoost()) <= 1)
            return;

        var minBuildings = Math.ceil(this.buildings() * parseInt(this.percentBoost()) / (parseInt(this.percentBoost()) - 1));
        let nextBoost = Math.ceil(parseInt(this.percentBoost()) * this.buildings() / minBuildings)
        this.percentBoost(Math.min(nextBoost, parseInt(this.percentBoost()) - 1));
    }

    decrementBuildings() {
        let nextBuildings = Math.floor(this.buildings());
        if (nextBuildings <= 0)
            return;

        if (this.buildings() - nextBuildings < 0.01)
            nextBuildings = Math.floor(nextBuildings - 0.01);
        var nextBoost = Math.ceil(100 * this.boost() * this.buildings() / nextBuildings);
        if (nextBoost - parseInt(this.percentBoost()) < 1)
            nextBoost = parseInt(this.percentBoost()) + 1;
        this.percentBoost(nextBoost);
    }

    incrementPercentBoost() {
        this.percentBoost(parseInt(this.percentBoost()) + 1);
    }

    decrementPercentBoost() {
        this.percentBoost(parseInt(this.percentBoost()) - 1);
    }

}

class Demand extends NamedElement {
    constructor(config) {
        super(config);

        this.amount = ko.observable(0);

        this.product = assetsMap.get(this.guid);
        if (this.product) {
            this.product.add(this);
            this.demands = this.product.getInputs().map(input => {

                let d = new Demand({ guid: input.Product });
                this.amount.subscribe(val => d.updateAmount(val * input.Amount));
                return d;
            });


            this.amount.subscribe(val => {
                this.product.updateAmount();
            });

            if (this.product.producer) {

                let factoryTpmin = assetsMap.get(this.product.producer).tpmin;
                this.buildings = ko.computed(() => parseFloat(this.amount()) / factoryTpmin / this.product.boost());
            }
        }
    }

    updateAmount(amount) {
        this.amount(amount);
    }
}

class Need extends Demand {
    constructor(config) {
        super(config);
        this.allDemands = [];
        if (this.happiness) {
            this.optionalAmount = ko.observable(0);
            view.settings.noOptionalNeeds.checked.subscribe(checked => {
                if (checked)
                    this.amount(0);
                else
                    this.amount(this.optionalAmount());
            })
        }

        let treeTraversal = node => {
            this.allDemands.push(node);
            (node.demands || []).forEach(treeTraversal);
        }
        treeTraversal(this);
    }

    updateAmount(inhabitants) {
        if (this.optionalAmount) {
            this.optionalAmount(this.tpmin * inhabitants)
            if (!view.settings.noOptionalNeeds.checked())
                this.amount(this.tpmin * inhabitants);
        } else {
            this.amount(this.tpmin * inhabitants);
        }
    }
}


class BuildingMaterialsNeed extends Need {
    updateAmount(buildings) {
        let factory = assetsMap.get(this.product.producer);
        this.amount(buildings * factory.tpmin * this.product.boost());
    }
}

class PopulationLevel extends NamedElement {
    constructor(config) {
        super(config);
        this.amount = ko.observable(0);
        this.noOptionalNeeds = ko.observable(false);
        this.needs = [];
        config.needs.forEach(n => {
            if (n.tpmin > 0)
                this.needs.push(new Need(n));
        });
        this.amount.subscribe(val => this.needs.forEach(n => n.updateAmount(val)));
    }

    incrementAmount() {
        this.amount(parseFloat(this.amount()) + 1);
    }

    decrementAmount() {
        this.amount(parseFloat(this.amount()) - 1);
    }
}

class ProductCategory extends NamedElement {
    constructor(config) {
        super(config);
        this.products = config.products.map(p => assetsMap.get(p));
    }
}

class Workforce extends NamedElement {
    constructor(config) {
        super(config);
        this.amount = ko.observable(0);
        this.demands = [];
    }

    updateAmount() {
        var sum = 0;
        this.demands.forEach(d => sum += d.amount());
        this.amount(sum);
    }

    add(demand) {
        this.demands.push(demand);
    }
}

class WorkforceDemand extends NamedElement {
    constructor(config) {
        super(config);
        this.amount = ko.observable(0);
        this.workforce.add(this);
        this.amount.subscribe(val => this.workforce.updateAmount());
    }

    updateAmount(buildings) {
        this.amount(Math.ceil(buildings) * this.Amount);
    }
}

function reset() {
    assetsMap.forEach(a => {
        if (a instanceof Product) {
            a.percentBoost(100);               
        }
        if (a instanceof PopulationLevel)
            a.amount(0);
    });

    view.buildingMaterialsNeeds.forEach(b => b.product.buildings(0));
}

function init() {
    $(document).on("keydown", (evt)=>{
      $(".ui-race-unit-name").filter(function() {
        return (new RegExp(`^${evt.key}`, 'i')).test($(this).text());
      }).each((i, ele) =>
        $(ele).closest('.ui-race-unit').find('input').focus().select()
      );
      return evt.target.tagName === 'INPUT'
        && !isNaN(parseInt(evt.key)) || ['ArrowUp','ArrowDown','Backspace','Delete'].includes(evt.key)
    });

    for (attr in texts) {
        view.texts[attr] = new NamedElement({ name: attr, locaText: texts[attr] });
    }

    view.settings.options = [];
    for (attr in options) {
        let o = new Option(options[attr]);
        o.id = attr;
        view.settings[attr] = o;
        view.settings.options.push(o);

        if (localStorage) {
            let id = "settings." + attr;
            if (localStorage.getItem(id))
                o.checked(localStorage.getItem(id));

            o.checked.subscribe(val => localStorage.setItem(id, val));
        }
    }
    view.settings.languages = params.languages;


    for (workforce of params.workforce) {
        let w = new Workforce(workforce)
        assetsMap.set(w.guid, w);
        view.workforce.push(w);
    }

    for (factory of params.factories) {
        let f = new Factory(factory)
        assetsMap.set(f.guid, f);
        view.factories.push(f);
    }

    let products = [];
    for (product of params.products) {
        if (product.producer) {
            let p = new Product(product);

            products.push(p);
            assetsMap.set(p.guid, p);

            if (localStorage) {
                let id = p.guid + ".percentBoost";
                if (localStorage.getItem(id))
                    p.percentBoost(parseInt(localStorage.getItem(id)));

                p.percentBoost.subscribe(val => localStorage.setItem(id, val));
            }
        }
    }

    view.factories.forEach(f => f.referenceProducts());


    for (level of params.populationLevels) {
        let l = new PopulationLevel(level)
        assetsMap.set(l.guid, l);
        view.populationLevels.push(l);

        if (localStorage) {
            let id = l.guid + ".amount";
            if (localStorage.getItem(id))
                l.amount(parseInt(localStorage.getItem(id)));

            l.amount.subscribe(val => localStorage.setItem(id, val));
        }
    }

    for (category of params.productFilter) {
        let c = new ProductCategory(category);
        assetsMap.set(c.guid, c);
        view.categories.push(c);
    }

    for (let b of view.categories[1].products) {

        if (b && b.demands.length == 0) {
            b.editable = true;
            let n = new BuildingMaterialsNeed({ guid: b.guid, product: b });
            b.buildings = ko.observable(0);
            b.buildings.subscribe(val => {
                if (!(typeof val === 'number'))
                    val = parseFloat(val);
                n.updateAmount(val);
            });
            b.boost.subscribe(() => n.updateAmount(b.buildings()));
            view.buildingMaterialsNeeds.push(n);

            if (localStorage) {
                let id = n.guid + ".buildings";
                if (localStorage.getItem(id))
                    b.buildings(parseInt(localStorage.getItem(id)));

                b.buildings.subscribe(val => localStorage.setItem(id, val));
            }
        }
    }

    ko.applyBindings(view, $(document.body)[0]);
}

function removeSpaces(string) {
    if (typeof string === "function")
        string = string();
    return string.replace(/\W/g, "");
}

$(document).ready(function () {
    if (window.params == null)
        $('#params-dialog').modal("show");
    else
        init();

    $('#params-dialog').on('hide.bs.modal', () => {
        try {
            window.params = JSON.parse($('textarea#input-params').val());
            init();
        } catch (e) {
            console.log(e);
            $('#params-dialog').modal("show");
        }
    })
})

texts = {
    inhabitants: {
        english: "Inhabitants",
        german: "Bevölkerung"
    },
    workforce: {
        english: "Required Workforce",
        german: "Benötigte Arbeitskraft"
    },
    productionBoost: {
        english: "Production Boost",
        german: "Produktionsboost"
    },
    requiredNumberOfBuildings: {
        english: "Required Number of Buildings",
        german: "Benötigte Anzahl an Gebäuden"
    },
    tonsPerMinute: {
        english: "Production in Tons per Minute",
        german: "Produktion in Tonnen pro Minute"
    },
    language: {
        english: "Language",
        german: "Sprache"
    },
    settings: {
        english: "Settings",
        german: "Einstellungen"
    },
    help: {
        english: "Help",
        german: "Hilfe"
    },
    helpContent: {
        german:
            `Verwendung: Trage die aktuellen oder angestrebten Einwohner pro Stufe in die oberste Reihe ein. Die Produktionsketten aktualisieren sich automatisch sobald man die Eingabe verlässt. Es werden nur diejenigen Fabriken angezeigt, die benötigt werden.

In der darunterliegenden Reihe wird die Arbeitskraft angezeigt, die benötigt wird, um alle Gebäude zu betreiben (jeweils auf die nächste ganze Fabrik gerundet).

Danach folgen zwei große Abschnitte, die sich wiederum in Unterabschnitte unterteilen. Der erste gibt einen Überblick über alle benötigten Gebäude, sortiert nach dem produzierten Warentyp. Der zweite schlüsselt die einzelnen Produktionsketten nach Bevölkerungsstufen auf. Jeder der Abschnitte kann durch einen Klick auf die Überschrift zusammengeklappt werden.

In jeder Kachel wird der Name der Fabrik, das Icon der hergestellten Ware, der Boost für den Gebäudetyp, die Anzahl der benötigten Gebäude und die Produktionsrate in Tonnen pro Minute angezeigt. Die Anzahl der Gebäude wird mit zwei Nachkommastellen angezeigt, um die Höhe der Überkapazitäten direkt ablesen zu können. Daneben befinden sich zwei Buttons. Diese versuchen den Boost so einzustellen, dass alle Gebäude des Typs bestmöglich ausgelastet sind und dabei ein Gebäude mehr (+) bzw. eines weniger (-) benötigt wird.

Da Baumaterialien sich Zwischenmaterialien mit Konsumgütern teilen sind sie (im Gegensatz zu Warenrechnern früherer Annos) mit aufgeführt, um so den Verbrauch von Minen besser planen zu können. Es muss die Anzahl der Endbetriebe per Hand eingegeben werden.

Über das Zahnrad am rechten oberen Bildschirmrand gelangt man zu den Einstellungen. Dort können die Sprache ausgewählt, der Warenrechner heruntergeladen und Einstellungen für die Warenberechnung getroffen werden.


Haftungsausschluss:
Der Warenrechner wird ohne irgendeine Gewährleistung zur Verfügung gestellt. Die Arbeit wurde in KEINER Weise von Ubisoft Blue Byte unterstützt. Alle Assets aus dem Spiel Anno 1800 sind © by Ubisoft.
Dies sind insbesondere, aber nicht ausschließlich alle Icons der Bevölkerung, Waren und Gegenstände sowie die Daten der Produktionsketten und die Verbrachswerte der Bevölkerung.

Diese Software steht unter der MIT-Lizenz.


Autor:
Nico Höllerich

Fehler und Verbesserungen:
Falls Sie auf Fehler oder Unannehmlichkeiten stoßen oder Verbesserungen vorschlagen möchten, erstellen Sie ein Issue auf Github (https://github.com/NiHoel/Anno1800Calculator/issues)`,

        english:
            `Usage: Enter the current or desired number of inhabitants per level into the top most row. The production chains will update automatically when one leaves the input field. Only the required factories are displayed. 

The row below displays the workforce that is required to run all buildings (rounded towards the next complete factory).

Afterwards two big sections follow that are subdivided into smaller sections. The first one gives an overview of the required buildings sorted by the type of good that is produced. The second one lists the individual production chains for each population level. Clicking the heading collapses each section.

Each card displays the name of the factory, the icon of the produced good, the boost for the given type of building, the number of required buildings, and the production rate in tons per minute. The number of buildings has two decimal places to directly show the amount of overcapacities. There are two buttons next to it. Those try to adjust the boost such that all buildings operate at full capacity and one more (+) or one building less (-) is required.

Since construction materials share intermediate products with consumables they are explicitly listed (unlike in calculators for previous Annos) to better plan the production of mines. The number of factories must be entered manually.

When clicking on the cog wheel in the upper right corner of the screen the settings dialog opens. There, one can chose the language, download the calculator and chose options affecting the calculation.


Disclaimer: 
The calculator is provided without warranty of any kind. The work was NOT endorsed by Ubisoft Blue Byte in any kind. All the assets from Anno 1800 game are © by Ubsioft.
These are especially but not exclusively all the icons of population, goods and items and the data of production chains and the consumptions values of population.

This software is under the MIT license.


Author:
Nico Höllerich

Bugs and improvements:
If you encounter any bugs or inconveniences or if you want to suggest improvements, create an Issue on Github (https://github.com/NiHoel/Anno1800Calculator/issues)`
    }
}

options = {
    "oldWorldMarquetry": {
        "name": "Produce marquetry in the Old World",
        "locaText": {
            "english": "Produce marquetry in the Old World",
            "german": "Produziere Furniere in der Alten Welt"
        }
    },
    "useCharcoal": {
        "name": "Use Charcoal",
        "locaText": {
            "english": "Use Charcoal",
            "german": "Verwende Holzkohle"
        }
    },
    "noOptionalNeeds": {
        "name": "Do not produce luxury goods",
        "locaText": {
            "english": "Do not produce luxury goods",
            "german": "Keine Luxusgüter produzieren"
        }
    },
    "decimalsForBuildings": {
        "name": "Show number of buildings with decimals",
        "locaText": {
            "english": "Show number of buildings with decimals",
            "german": "Zeige Nachkommastellen bei der Gebäudeanzahl"
        }
    },
    "hideNames": {
        "name": "Hide the names of products, factories, and population levels",
        "locaText": {
            "english": "Hide the names of products, factories, and population levels",
            "german": "Verberge die Namen von Produkten, Fabriken und Bevölkerungsstufen"
        }
    },
    "hideProductionBoost": {
        "name": "Hide the input fields for production boost",
        "locaText": {
            "english": "Hide the input fields for production boost",
            "german": "Verberge das Eingabefelder für Produktionsboosts"
        }
    },
}
