const path = require('path');
const webpack = require('webpack');

module.exports = {
    mode: 'production',
    target: 'web',
    entry: { webview: './src/index.tsx' },
    output: {
        path: path.resolve(__dirname, '..', '..', 'dist'),
        filename: '[name].js',
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
    plugins: [
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify('production'),
        }),
    ],
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                use: [{
                    loader: 'ts-loader',
                    options: { configFile: path.resolve(__dirname, 'src', 'tsconfig.json') },
                }],
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader'],
            },
        ],
    },
};
