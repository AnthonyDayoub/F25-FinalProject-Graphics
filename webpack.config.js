/* global module, require, __dirname */
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
    entry: {
        'final-project': './src/final-project.js',
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
                // This rule is good, but it won't be used by GLTFLoader
                // It's for when you import a model directly in your JS
                test: /\.(stl|obj|mtl|gltf|glb)$/i,
                type: 'asset/resource',
                generator: { filename: 'models/[name][ext]', },
            }
        ],
    },
    resolve: {
        extensions: ['.js']
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './src/index.html',
            filename: 'index.html',
            // --- FIX 1 ---
            // Point to the correct entry chunk name
            chunks: ['final-project'], 
        }),
        new CopyWebpackPlugin({
            patterns: [
                { from: path.resolve(__dirname, 'src/cyberpunk_car'), to: 'cyberpunk_car' },
                { from: path.resolve(__dirname, 'src/mario_kart_8_deluxe_-_wii_moonview_highway'), to: 'mario_kart_8_deluxe_-_wii_moonview_highway' },
            ],
        }),
    ],
    devServer: {
        // --- FIX 2 ---
        // Tell the server to serve static files (like your model)
        // from the 'src' directory.
        static: {
            directory: path.join(__dirname, 'src'),
        },
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
