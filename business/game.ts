import { Player } from "./player";
import { Commodity } from "./commodity";
import { Util } from "./util";
import { Table, Terminal, BaseService, Prompt, TableService } from "../../@hawryschuk-terminal-restapi";

export class AutoTerminal extends Terminal {
    async prompt(options: Prompt) {
        return await super.prompt({ ...options, resolved: 'initial' in options ? options.initial : null });
    }
}

/** Stock-Ticker : spot prices, player assets */
// https://magisterrex.files.wordpress.com/2014/07/stocktickerrules.pdf
export class Game extends BaseService {
    table!: Table;
    players: Player[];
    turn: Player;
    commodities: { [name: string]: Commodity } = ['oil', 'bonds', 'gold', 'silver', 'grain', 'industrial'].reduce((commodities, name) => ({ ...commodities, [name]: new Commodity(name) }), {});
    canTrade = true;    // Once the user rolls the dice, they cannot trade
    history: {
        amount: number;
        direction: 'up' | 'down' | 'dividend';
        commodity: Commodity
    }[] = [];
    rolled: { amount: number; direction: 'up' | 'down' | 'dividend'; commodity: Commodity } = {
        amount: 0,
    } as any;

    constructor({ table = null, terminals = [] } = {} as { table?: Table; terminals?: Terminal[]; }) {
        super({ table: table as any });
        this.players = terminals.map((terminal, i) => new Player(terminal || new AutoTerminal({ history: [{ type: 'prompt', options: { name: 'name', type: 'text', message: '', resolved: `Robot ${i + 1}` } }] }), this));
        this.turn = this.players[0];
        if (this.serviceState) this.state = this.serviceState;
    }

    static FINISHED_WHEN_HISTORY = 100;

    get finished() { return this.history.length > Game.FINISHED_WHEN_HISTORY }

    get Commodities() { return Object.values(this.commodities) }

    get terminal(): Terminal {
        const players: Player[] = this.players.filter(player => player.terminal && new TableService(player.terminal).serviceState);
        return players.includes(this.turn) ? this.turn.terminal : players[0]?.terminal;
    }

    get serviceState() { return this.terminal && new TableService(this.terminal).serviceState; }

    get losers() { return this.players.filter(p => p !== this.winner) }

    get winner() {
        return this
            .players
            .map(player => ({ player, worth: player.worth }))
            .sort((a, b) => a.worth - b.worth)
            .pop()!
            .player
    }

    /** FEAT: Trade something */
    trade(action: 'buy' | 'sell', commodity: Commodity, units: number) {
        if (this.canTrade) {
            this.turn.trade(action, commodity, units);
        } else {
            throw new Error('TradeNowAllowed');
        }
    }

    /** FEAT: RollDice */
    roll({
        amount = Util.random([5, 10, 20]),
        direction = Util.random(['up', 'down', 'dividend']),
        commodity = Util.random(Object.values(this.commodities)),
    } = {}) {
        /** RULE: Once you start rolling you cannot trade */
        this.canTrade = false;

        Object.assign(this.rolled, { amount, direction, commodity });

        this.history.push({ ...this.rolled });

        if (/up|down/.test(direction)) {
            commodity.price += amount / 100 * (direction === 'up' ? 1 : -1);

            /** FEAT: Bankpruptcy */
            if (commodity.price <= 0) {
                for (const p of this.players) {
                    p.assets[commodity.name] = 0;
                }
                commodity.price = 1;
            }

            /** FEAT: StockSplit */
            if (commodity.price >= 2) {
                for (const p of this.players) {
                    p.assets[commodity.name] *= 2;
                }
                commodity.price = 1;
            }
        } else if (commodity.price >= 1) {
            /** FEAT: Dividend */
            for (const { assets } of this.players) {
                const dividend = assets[commodity.name] * amount / 100;
                if (commodity.price >= 1) assets[commodity.name] += dividend;
            }
        }

        /** FEAT: Next Player */
        // if (direction === 'down') {
        this.turn = this.players[this.players.indexOf(this.turn) + 1] || this.players[0];
        this.canTrade = true;
        // }
    }

    get state() {
        return {
            history: this.history,
            turn: this.turn?.name,
            commodities: this.commodities,
            rolled: this.rolled,
            players: this.players.map(player => ({
                name: player.name,
                cash: player.cash,
                assets: player.assets,
                worth: player.worth
            }))
        };
    }

    set state({ history, commodities, rolled, players, turn }) {
        players.forEach(({ name, cash, assets }, i) => {
            Object.assign(this.players[i], {
                cash,
                assets,
                name
            });
        });
        Object.assign(this, {
            history,
            commodities,
            rolled,
            turn: this.players.find(p => p.name === turn),
        });
        players.forEach(({ name, cash, assets }, i) => {
            Object.assign(this.players[i], {
                cash,
                assets,
                name
            });
        });
        // debugger;
    }

    /** Play the game through prompts and stdout */
    async auto(game = this) {
        if (!this.turn) throw new Error('Nobodys turn!');
        if (game.finished) throw new Error('Game Finished: Nothing to auto');
        if (!game.serviceState) { await game.broadcast(JSON.stringify({ state: this.state })); } // broadcast the game state for the first time 

        //#region get choice from Choices[ title,value, handler ]
        const choices = [
            {
                title: 'roll dice',
                value: 'roll-dice',
            },
            ...Object.entries(game.turn?.assets || {}).filter(([name, units]) => units).map(([name, units]) => ({
                value: `sell-${name}`,
                title: `Sell ${name} (${units}-units @ ${this.commodities[name].price} => ${units * this.commodities[name].price})`
            })),
            ...Object.entries(game.commodities).filter(() => game.turn?.cash).map(([name, commodity]) => ({
                value: `buy-${name}`,
                title: `Buy ${name} (${Math.floor(game.turn.cash / commodity.price)}-units @ $${commodity.price})`,
                disabled: !game.turn.cash
            })),
        ];
        const handlers: any = {
            'roll-dice': async () => {
                const { name } = this.turn;
                game.roll();
                await game.broadcast(`${name} rolled ${JSON.stringify(game.rolled)}`);
                if (game.finished) {
                    await game.broadcast(`${this.winner.name} wins the game`);
                    console.log('finished game', game.players.map(p => p.terminal));
                    await Promise.all(game.players.map(p => p.terminal.prompt({ name: 'ack_game', message: 'Game over, press any key to continue', type: 'text' })))
                    this.results = { winners: [this.winner.name], losers: this.losers.map(l => l.name) };
                }
            },
            ...Object.entries(game.turn?.assets || {}).filter(() => this.canTrade).reduce((handlers, [name, units]) => ({
                ...handlers,
                [`sell-${name}`]: async () => {
                    const _units = await game.turn.terminal.prompt({
                        message: `How many units of ${name} would you like to sell? (max=${units})`,
                        name: 'units',
                        type: 'number',
                        min: 0,
                        max: units,
                        initial: units,
                    });
                    if (_units > 0 && _units <= units) {
                        game.trade('sell', game.commodities[name], units);
                        await game.broadcast(`${game.turn.name} has sold ${units} of ${name} @ ${game.commodities[name].price} per share for $ $${units * game.commodities[name].price}`);
                    }
                }
            }), {}),
            ...Object.entries(game.commodities).filter(() => this.canTrade).reduce((handlers, [name, commodity]) => ({
                ...handlers,
                [`buy-${name}`]: async () => {
                    const units = await game.turn.terminal.prompt({
                        message: `How many units of ${name} would you like to buy? (max=${Math.floor(game.turn.cash / commodity.price)})`,
                        name: 'units',
                        type: 'number',
                        min: 0,
                        max: Math.floor(game.turn.cash / commodity.price),
                        initial: Math.floor(game.turn.cash / commodity.price),
                    });
                    game.trade('buy', commodity, units);
                    await game.broadcast(`${game.turn.name} has bought ${units} of ${name} @ ${commodity.price} per share for $ $${units * commodity.price}`);
                }
            }), {}),
        };

        const choice = await this.turn.terminal.prompt({
            type: 'select',
            name: 'stock-ticker-action',
            message: 'what would you like to do?',
            initial: 'roll-dice',
            clobber: true,
            choices
        });
        //#endregion

        /** Perform the chosen action */
        if (!handlers[choice]) console.log('no handler for choice', choice);
        else if (!(choices as any).find((c: any) => c.value === choice)) console.log('unknown choice', choice)
        else if ((choices as any).find((c: any) => c.value === choice).disabled) console.log('choice is disabled', choice)
        else await handlers[choice]();

        /** Broadcast the game state */
        await game.broadcast(JSON.stringify({ state: this.state }));
    }
}

