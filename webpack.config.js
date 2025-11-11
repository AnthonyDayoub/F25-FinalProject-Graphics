/* global module, require, __dirname */
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin'); // <-- 1. ADD THIS LINE

module.exports = {
    entry: {
        'flight-sim': './src/flight-sim.js',
    },
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
        clean: true,
    },
    module: {
        rules: [
            {
                test: /\.css$/i,
                use: ['style-loader', 'css-loader'],
            },
            {
                test: /\.(png|jpg|jpeg|gif|svg)$/i,
                type: 'asset/resource',
                generator: { filename: 'images/[name][ext]', },
            },
            {
                test: /\.(stl|obj|mtl|gltf|glb)$/i,
                type: 'asset/resource',
                generator: { filename: 'models/[name][ext]', },
            }
        ],
    },
    resolve: {
        extensions: ['.js']
    },
   // webpack.config.js

    plugins: [
        new HtmlWebpackPlugin({
            template: './src/index.html',
            filename: 'index.html',
            chunks: ['flight-sim'],
        }),

        new CopyWebpackPlugin({
            patterns: [
                { 
                    // This now correctly points to your source folder
                    from: path.resolve(__dirname, 'src/fortnite_plane'), 
                    to: 'fortnite_plane'
                }
            ]
        })
    ],
    devServer: {
        compress: true,
        port: 8085,
        hot: true,
    },
    performance: {
        hints: false,
        maxEntrypointSize: 512000,
        maxAssetSize: 512000,
    },
    target: ['web', 'es2020'],
};