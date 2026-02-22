// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { UniswapV2Library } from "./UniswapV2Library.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint value) external returns (bool);
    function transfer(address to, uint value) external returns (bool);
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint) external;
    function transfer(address to, uint value) external returns (bool);
    function transferFrom(address from, address to, uint value) external returns (bool);
}

interface IUniswapV2FactoryRouter {
    function getPair(address, address) external view returns (address);
    function createPair(address, address) external returns (address);
}

interface IUniswapV2PairRouter {
    function swap(uint amount0Out, uint amount1Out, address to) external;
    function mint(address to) external returns (uint liquidity);
}

contract UniswapV2Router02 {
    address public immutable factory;
    address public immutable WETH;

    constructor(address _factory, address _WETH) {
        factory = _factory;
        WETH = _WETH;
    }

    receive() external payable {
        require(msg.sender == WETH, "ROUTER: ETH_ONLY");
    }

    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts) {
        return UniswapV2Library.getAmountsOut(factory, amountIn, path);
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        address to
    ) external returns (uint amountA, uint amountB, uint liquidity) {
        address pair = _ensurePair(tokenA, tokenB);
        (uint reserveA, uint reserveB) = UniswapV2Library.getReserves(factory, tokenA, tokenB);

        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint amountBOptimal = UniswapV2Library.quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint amountAOptimal = UniswapV2Library.quote(amountBDesired, reserveB, reserveA);
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }

        require(IERC20(tokenA).transferFrom(msg.sender, pair, amountA), "ROUTER: TRANSFER_A");
        require(IERC20(tokenB).transferFrom(msg.sender, pair, amountB), "ROUTER: TRANSFER_B");
        liquidity = IUniswapV2PairRouter(pair).mint(to);
    }

    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        address to
    ) external payable returns (uint amountToken, uint amountETH, uint liquidity) {
        address pair = _ensurePair(token, WETH);
        (uint reserveToken, uint reserveETH) = UniswapV2Library.getReserves(factory, token, WETH);

        if (reserveToken == 0 && reserveETH == 0) {
            (amountToken, amountETH) = (amountTokenDesired, msg.value);
        } else {
            uint amountETHOptimal = UniswapV2Library.quote(amountTokenDesired, reserveToken, reserveETH);
            if (amountETHOptimal <= msg.value) {
                (amountToken, amountETH) = (amountTokenDesired, amountETHOptimal);
            } else {
                uint amountTokenOptimal = UniswapV2Library.quote(msg.value, reserveETH, reserveToken);
                (amountToken, amountETH) = (amountTokenOptimal, msg.value);
            }
        }

        require(IERC20(token).transferFrom(msg.sender, pair, amountToken), "ROUTER: TRANSFER_TOKEN");
        IWETH(WETH).deposit{value: amountETH}();
        require(IWETH(WETH).transfer(pair, amountETH), "ROUTER: WETH_TRANSFER");
        liquidity = IUniswapV2PairRouter(pair).mint(to);

        if (msg.value > amountETH) {
            payable(msg.sender).transfer(msg.value - amountETH);
        }
    }

    function _ensurePair(address tokenA, address tokenB) private returns (address pair) {
        pair = IUniswapV2FactoryRouter(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) {
            pair = IUniswapV2FactoryRouter(factory).createPair(tokenA, tokenB);
        }
    }

    function _swap(uint[] memory amounts, address[] memory path, address _to) private {
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = UniswapV2Library.sortTokens(input, output);
            uint amountOut = amounts[i + 1];
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOut) : (amountOut, uint(0));
            address to = i < path.length - 2 ? UniswapV2Library.pairFor(factory, output, path[i + 2]) : _to;
            address pair = UniswapV2Library.pairFor(factory, input, output);
            IUniswapV2PairRouter(pair).swap(amount0Out, amount1Out, to);
        }
    }

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        require(block.timestamp <= deadline, "ROUTER: EXPIRED");
        require(path.length >= 2, "ROUTER: PATH");

        _ensurePair(path[0], path[1]);
        amounts = UniswapV2Library.getAmountsOut(factory, amountIn, _toMemory(path));
        require(amounts[amounts.length - 1] >= amountOutMin, "ROUTER: INSUFFICIENT_OUTPUT");

        address pair = UniswapV2Library.pairFor(factory, path[0], path[1]);
        require(IERC20(path[0]).transferFrom(msg.sender, pair, amounts[0]), "ROUTER: TRANSFER_FROM");
        _swap(amounts, _toMemory(path), to);
    }

    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts) {
        require(block.timestamp <= deadline, "ROUTER: EXPIRED");
        require(path.length >= 2 && path[0] == WETH, "ROUTER: PATH");

        _ensurePair(path[0], path[1]);
        amounts = UniswapV2Library.getAmountsOut(factory, msg.value, _toMemory(path));
        require(amounts[amounts.length - 1] >= amountOutMin, "ROUTER: INSUFFICIENT_OUTPUT");

        IWETH(WETH).deposit{value: amounts[0]}();
        address pair = UniswapV2Library.pairFor(factory, path[0], path[1]);
        require(IWETH(WETH).transfer(pair, amounts[0]), "ROUTER: WETH_TRANSFER");
        _swap(amounts, _toMemory(path), to);
    }

    function swapExactTokensForETH(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        require(block.timestamp <= deadline, "ROUTER: EXPIRED");
        require(path.length >= 2 && path[path.length - 1] == WETH, "ROUTER: PATH");

        _ensurePair(path[0], path[1]);
        amounts = UniswapV2Library.getAmountsOut(factory, amountIn, _toMemory(path));
        require(amounts[amounts.length - 1] >= amountOutMin, "ROUTER: INSUFFICIENT_OUTPUT");

        address pair = UniswapV2Library.pairFor(factory, path[0], path[1]);
        require(IERC20(path[0]).transferFrom(msg.sender, pair, amounts[0]), "ROUTER: TRANSFER_FROM");

        _swap(amounts, _toMemory(path), address(this));
        uint amountOut = amounts[amounts.length - 1];
        IWETH(WETH).withdraw(amountOut);
        payable(to).transfer(amountOut);
    }

    function _toMemory(address[] calldata path) private pure returns (address[] memory m) {
        m = new address[](path.length);
        for (uint i; i < path.length; i++) m[i] = path[i];
    }
}
