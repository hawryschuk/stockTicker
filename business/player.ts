import { Game } from "./game";
import { Commodity } from "./commodity";
import { Terminal } from '@hawryschuk/terminals/Terminal';

export class Player {
    cash = 5000;
    assets: { [name: string]: number; } = Object.values(this.game.commodities).reduce((assets, commodity) => ({ ...assets, [commodity.name]: 0 }), {});

    constructor(public terminal: Terminal, public game: Game) {
        this.name = terminal.input.name;
    }

    can(action: string): any {
        return this.terminal.prompts['stock-ticker-action']
            && this
                .terminal.prompts['stock-ticker-action']![0]!
                .choices!
                .find(c => c.value === action && !c.disabled)
    }

    name: string;

    units(commodity: Commodity) { return this.assets[commodity.name] || 0; }

    trade(action: 'buy' | 'sell', commodity: Commodity, units: number) {
        const { price } = commodity;
        const cost = (action === 'buy' ? 1 : -1) * units * price;
        if (cost > this.cash) throw new Error('InsufficientFunds: ' + JSON.stringify({ cost, price }));
        this.cash -= cost;
        this.assets[commodity.name] += units * (action === 'buy' ? 1 : -1);

    }

    get worth() {
        return Object.keys(this.assets).reduce(
            (cash, asset) => cash + this.assets[asset] * this.game.commodities[asset].price,
            this.cash
        );
    }
}
