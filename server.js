const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const Razorpay = require('razorpay');
const crypto = require('crypto'); // For signature verification

const app = express();
app.use(express.json());
app.use(cors({
    origin: 'https://67ddb1445507ef147e0b01e7--tubular-bombolone-71c0ae.netlify.app/', // Replace with your actual Netlify URL
    methods: ['GET', 'POST'],
    credentials: true
}));

const razorpay = new Razorpay({
    key_id: 'rzp_test_srQdoIUxihBQFB', // Replace with your Razorpay Key ID
    key_secret: 'ACzLW7OASFm015Y5KzR6UJyO'   // Replace with your Razorpay Key Secret
});

const fallbackInventory = [
    { name: 'Shirts', stock: 50, price: 25, bestseller: true },
    { name: 'Bastar Art Products', stock: 20, price: 35, bestseller: false },
    { name: 'Bottles', stock: 30, price: 15, bestseller: true },
    { name: 'Keyrings', stock: 100, price: 5, bestseller: false },
    { name: 'Canvas', stock: 15, price: 40, bestseller: false },
    { name: 'Stationery', stock: 80, price: 10, bestseller: true },
];

let inMemoryInventory = [...fallbackInventory];
console.log('Initialized inMemoryInventory:', inMemoryInventory);
let inMemorySales = [];
let useInMemoryMode = false;

// Store cart items temporarily for verification
let pendingPurchases = new Map(); // Map to store cart items by order ID

const options = {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000
};

const uris = ['mongodb://127.0.0.1:27017', 'mongodb://localhost:27017'];
let currentUriIndex = 0;
let uri = uris[currentUriIndex];
let client = new MongoClient(uri, options);

let db, inventoryCollection, salesCollection;

async function connectToMongo() {
    try {
        await client.close(true).catch(() => {});
        client = new MongoClient(uri, options);
        await client.connect();
        console.log(`Connected to MongoDB at ${uri}`);
        db = client.db('jungleSafari');
        inventoryCollection = db.collection('inventory');
        salesCollection = db.collection('sales');
        await db.createCollection('inventory').catch(() => console.log('Inventory collection exists'));
        await db.createCollection('sales').catch(() => console.log('Sales collection exists'));
        useInMemoryMode = false;
        return true;
    } catch (error) {
        console.error('MongoDB connection error:', error.message);
        currentUriIndex = (currentUriIndex + 1) % uris.length;
        uri = uris[currentUriIndex];
        if (currentUriIndex === 0) {
            useInMemoryMode = true;
            console.log('Using in-memory mode due to repeated connection failures');
            return false;
        }
        return await connectToMongo();
    }
}

async function initializeData() {
    if (useInMemoryMode) return;
    const count = await inventoryCollection.countDocuments();
    if (count === 0) {
        await inventoryCollection.insertMany(fallbackInventory);
        console.log('Database initialized with sample inventory data');
    }
    const userCount = await db.collection('users').countDocuments();
    if (userCount === 0) {
        await db.collection('users').insertOne({
            username: 'admin',
            password: 'admin123',
            role: 'admin',
            isActive: true
        });
        console.log('Admin user created');
    }
}

async function ensureConnection() {
    if (useInMemoryMode) return false;
    try {
        await db.command({ ping: 1 });
        return true;
    } catch (error) {
        console.error('Database connection lost, reconnecting...', error.message);
        return await connectToMongo();
    }
}

async function startServer() {
    await connectToMongo() ? await initializeData() : console.error('Using in-memory mode');

    app.get('/api/inventory', async (req, res) => {
        try {
            if (useInMemoryMode) return res.json(inMemoryInventory);
            if (!await ensureConnection()) return res.json(inMemoryInventory);
            const items = await inventoryCollection.find().toArray();
            res.json(items);
        } catch (error) {
            console.error('Error fetching inventory:', error.message);
            res.json(inMemoryInventory);
        }
    });

    app.get('/api/bestsellers', async (req, res) => {
        try {
            if (useInMemoryMode) {
                console.log('In-memory mode: inMemorySales:', inMemorySales);
                const salesByProduct = {};
                inMemorySales.forEach(sale => {
                    salesByProduct[sale.product] = (salesByProduct[sale.product] || 0) + sale.quantity;
                });
                console.log('In-memory mode: salesByProduct:', salesByProduct);
                const bestsellers = inMemoryInventory
                    .map(item => ({
                        ...item,
                        totalSold: salesByProduct[item.name] || 0
                    }))
                    .sort((a, b) => b.totalSold - a.totalSold)
                    .slice(0, 3);
                console.log('In-memory mode: bestsellers before fallback:', bestsellers);
                if (bestsellers.length === 0 || bestsellers.every(item => item.totalSold === 0)) {
                    console.log('In-memory mode: No sales or empty bestsellers, falling back to default bestsellers');
                    const defaultBestsellers = inMemoryInventory.filter(item => item.bestseller === true);
                    console.log('In-memory mode: defaultBestsellers:', defaultBestsellers);
                    if (defaultBestsellers.length === 0) {
                        console.log('In-memory mode: No default bestsellers, returning first 3 items');
                        return res.json(inMemoryInventory.slice(0, 3));
                    }
                    return res.json(defaultBestsellers);
                }
                return res.json(bestsellers);
            }

            if (!await ensureConnection()) {
                console.log('Fallback to in-memory mode: inMemorySales:', inMemorySales);
                const salesByProduct = {};
                inMemorySales.forEach(sale => {
                    salesByProduct[sale.product] = (salesByProduct[sale.product] || 0) + sale.quantity;
                });
                console.log('Fallback to in-memory mode: salesByProduct:', salesByProduct);
                const bestsellers = inMemoryInventory
                    .map(item => ({
                        ...item,
                        totalSold: salesByProduct[item.name] || 0
                    }))
                    .sort((a, b) => b.totalSold - a.totalSold)
                    .slice(0, 3);
                console.log('Fallback to in-memory mode: bestsellers before fallback:', bestsellers);
                if (bestsellers.length === 0 || bestsellers.every(item => item.totalSold === 0)) {
                    console.log('Fallback to in-memory mode: No sales or empty bestsellers, falling back to default bestsellers');
                    const defaultBestsellers = inMemoryInventory.filter(item => item.bestseller === true);
                    console.log('Fallback to in-memory mode: defaultBestsellers:', defaultBestsellers);
                    if (defaultBestsellers.length === 0) {
                        console.log('Fallback to in-memory mode: No default bestsellers, returning first 3 items');
                        return res.json(inMemoryInventory.slice(0, 3));
                    }
                    return res.json(defaultBestsellers);
                }
                return res.json(bestsellers);
            }

            console.log('MongoDB mode: Fetching sales data');
            const salesAggregation = await salesCollection.aggregate([
                { $group: { _id: "$product", totalSold: { $sum: "$quantity" } } },
                { $sort: { totalSold: -1 } },
                { $limit: 3 }
            ]).toArray();
            console.log('MongoDB mode: salesAggregation:', salesAggregation);

            if (salesAggregation.length === 0) {
                console.log('MongoDB mode: No sales, falling back to default bestsellers');
                const defaultBestsellers = await inventoryCollection.find({ bestseller: true }).toArray();
                console.log('MongoDB mode: defaultBestsellers:', defaultBestsellers);
                if (defaultBestsellers.length === 0) {
                    console.log('MongoDB mode: No default bestsellers, returning first 3 items');
                    const firstThreeItems = await inventoryCollection.find().limit(3).toArray();
                    return res.json(firstThreeItems);
                }
                return res.json(defaultBestsellers);
            }

            const bestsellerNames = salesAggregation.map(sale => sale._id);
            const bestsellers = await inventoryCollection.find({ name: { $in: bestsellerNames } }).toArray();
            const bestsellersWithSales = bestsellers.map(item => ({
                ...item,
                totalSold: salesAggregation.find(sale => sale._id === item.name)?.totalSold || 0
            }));
            console.log('MongoDB mode: bestsellersWithSales:', bestsellersWithSales);
            res.json(bestsellersWithSales);
        } catch (error) {
            console.error('Error fetching bestsellers:', error.message);
            res.status(500).json({ error: 'Failed to fetch bestsellers' });
        }
    });

    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', mode: useInMemoryMode ? 'in-memory' : 'mongodb', time: new Date().toISOString() });
    });

    // Updated /api/create-order to store cart items
    app.post('/api/create-order', async (req, res) => {
        const { amount, currency = 'INR', receipt, items } = req.body;

        if (!amount || amount <= 0 || !items || !Array.isArray(items)) {
            return res.status(400).json({ error: 'Invalid amount or items' });
        }

        try {
            const order = await razorpay.orders.create({
                amount: amount * 100, // Razorpay expects amount in paise
                currency,
                receipt: receipt || `receipt_${Date.now()}`,
                payment_capture: 1 // Auto-capture payment
            });

            // Store the cart items temporarily using the order ID
            pendingPurchases.set(order.id, items);

            res.json({
                id: order.id,
                amount: order.amount,
                currency: order.currency,
                key: razorpay.key_id
            });
        } catch (error) {
            console.error('Error creating Razorpay order:', error.message);
            res.status(500).json({ error: 'Failed to create order' });
        }
    });

    // New endpoint to verify payment and redirect
    app.post('/api/verify-payment', async (req, res) => {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        try {
            // Verify the payment signature
            const generatedSignature = crypto
                .createHmac('sha256', razorpay.key_secret)
                .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                .digest('hex');

            if (generatedSignature !== razorpay_signature) {
                console.error('Invalid payment signature');
                return res.redirect('https://67ddb1445507ef147e0b01e7--tubular-bombolone-71c0ae.netlify.app//payment-failure.html?error=Invalid%20signature');
            }

            // Payment verified, retrieve the cart items
            const items = pendingPurchases.get(razorpay_order_id);
            if (!items) {
                console.error('Order not found in pending purchases');
                return res.redirect('https://67ddb1445507ef147e0b01e7--tubular-bombolone-71c0ae.netlify.app//payment-failure.html?error=Order%20not%20found');
            }

            // Process the purchase
            try {
                if (useInMemoryMode) {
                    for (const { name, quantity } of items) {
                        const itemIndex = inMemoryInventory.findIndex(item => item.name === name);
                        if (itemIndex === -1) {
                            pendingPurchases.delete(razorpay_order_id);
                            return res.redirect('https://67ddb1445507ef147e0b01e7--tubular-bombolone-71c0ae.netlify.app//payment-failure.html?error=Product%20not%20found');
                        }
                        const item = inMemoryInventory[itemIndex];
                        if (item.stock < quantity) {
                            pendingPurchases.delete(razorpay_order_id);
                            return res.redirect('https://67ddb1445507ef147e0b01e7--tubular-bombolone-71c0ae.netlify.app//payment-failure.html?error=Not%20enough%20stock');
                        }
                        inMemoryInventory[itemIndex].stock -= parseInt(quantity);
                        inMemorySales.push({ product: name, quantity: parseInt(quantity), date: new Date(), totalPrice: item.price * quantity, channel: 'online' });
                    }
                } else {
                    if (!await ensureConnection()) {
                        for (const { name, quantity } of items) {
                            const itemIndex = inMemoryInventory.findIndex(item => item.name === name);
                            if (itemIndex === -1) {
                                pendingPurchases.delete(razorpay_order_id);
                                return res.redirect('https://67ddb1445507ef147e0b01e7--tubular-bombolone-71c0ae.netlify.app//payment-failure.html?error=Product%20not%20found');
                            }
                            const item = inMemoryInventory[itemIndex];
                            if (item.stock < quantity) {
                                pendingPurchases.delete(razorpay_order_id);
                                return res.redirect('https://67ddb1445507ef147e0b01e7--tubular-bombolone-71c0ae.netlify.app//payment-failure.html?error=Not%20enough%20stock');
                            }
                            inMemoryInventory[itemIndex].stock -= parseInt(quantity);
                            inMemorySales.push({ product: name, quantity: parseInt(quantity), date: new Date(), totalPrice: item.price * quantity, channel: 'online' });
                        }
                    } else {
                        for (const { name, quantity } of items) {
                            const item = await inventoryCollection.findOne({ name });
                            if (!item) {
                                pendingPurchases.delete(razorpay_order_id);
                                return res.redirect('https://67ddb1445507ef147e0b01e7--tubular-bombolone-71c0ae.netlify.app//payment-failure.html?error=Product%20not%20found');
                            }
                            if (item.stock < quantity) {
                                pendingPurchases.delete(razorpay_order_id);
                                return res.redirect('https://67ddb1445507ef147e0b01e7--tubular-bombolone-71c0ae.netlify.app//payment-failure.html?error=Not%20enough%20stock');
                            }
                            await inventoryCollection.updateOne({ name }, { $inc: { stock: -quantity } });
                            await salesCollection.insertOne({ product: name, quantity: parseInt(quantity), date: new Date(), totalPrice: item.price * quantity, channel: 'online' });
                        }
                    }
                }

                // Clear the pending purchase
                pendingPurchases.delete(razorpay_order_id);

                // Redirect to success page
                return res.redirect('https://67ddb1445507ef147e0b01e7--tubular-bombolone-71c0ae.netlify.app//payment-success.html');
            } catch (error) {
                console.error('Error processing purchase:', error.message);
                pendingPurchases.delete(razorpay_order_id);
                return res.redirect(`https://67ddb1445507ef147e0b01e7--tubular-bombolone-71c0ae.netlify.app//payment-failure.html?error=${encodeURIComponent(error.message)}`);
            }
        } catch (error) {
            console.error('Error verifying payment:', error.message);
            return res.redirect(`https://67ddb1445507ef147e0b01e7--tubular-bombolone-71c0ae.netlify.app//payment-failure.html?error=${encodeURIComponent(error.message)}`);
        }
    });

    app.post('/api/inventory/update', async (req, res) => {
        const { name, quantity, channel } = req.body;
        if (!name || !quantity || quantity <= 0) return res.status(400).json({ error: 'Invalid request data' });

        try {
            if (useInMemoryMode) {
                const itemIndex = inMemoryInventory.findIndex(item => item.name === name);
                if (itemIndex === -1) return res.status(404).json({ error: 'Product not found' });
                const item = inMemoryInventory[itemIndex];
                if (item.stock < quantity) return res.status(400).json({ error: `Not enough stock: ${item.stock}` });
                inMemoryInventory[itemIndex].stock -= parseInt(quantity);
                inMemorySales.push({ product: name, quantity: parseInt(quantity), date: new Date(), totalPrice: item.price * quantity, channel });
                return res.json({ message: `Sold ${quantity} ${name}(s)` });
            }

            if (!await ensureConnection()) return processInMemorySale(req, res);
            const item = await inventoryCollection.findOne({ name });
            if (!item) return res.status(404).json({ error: 'Product not found' });
            if (item.stock < quantity) return res.status(400).json({ error: `Not enough stock: ${item.stock}` });
            await inventoryCollection.updateOne({ name }, { $inc: { stock: -quantity } });
            await salesCollection.insertOne({ product: name, quantity: parseInt(quantity), date: new Date(), totalPrice: item.price * quantity, channel });
            res.json({ message: `Sold ${quantity} ${name}(s)` });
        } catch (error) {
            console.error('Error processing sale:', error.message);
            useInMemoryMode = true;
            return processInMemorySale(req, res);
        }
    });

    app.post('/api/purchase', async (req, res) => {
        const { items, channel } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Invalid purchase data' });
        }

        try {
            if (useInMemoryMode) {
                for (const { name, quantity } of items) {
                    const itemIndex = inMemoryInventory.findIndex(item => item.name === name);
                    if (itemIndex === -1) return res.status(404).json({ error: `Product ${name} not found` });
                    const item = inMemoryInventory[itemIndex];
                    if (item.stock < quantity) return res.status(400).json({ error: `Not enough stock for ${name}: ${item.stock}` });
                    inMemoryInventory[itemIndex].stock -= parseInt(quantity);
                    inMemorySales.push({ product: name, quantity: parseInt(quantity), date: new Date(), totalPrice: item.price * quantity, channel });
                }
                return res.json({ message: 'Purchase successful' });
            }

            if (!await ensureConnection()) {
                for (const { name, quantity } of items) {
                    const itemIndex = inMemoryInventory.findIndex(item => item.name === name);
                    if (itemIndex === -1) return res.status(404).json({ error: `Product ${name} not found` });
                    const item = inMemoryInventory[itemIndex];
                    if (item.stock < quantity) return res.status(400).json({ error: `Not enough stock for ${name}: ${item.stock}` });
                    inMemoryInventory[itemIndex].stock -= parseInt(quantity);
                    inMemorySales.push({ product: name, quantity: parseInt(quantity), date: new Date(), totalPrice: item.price * quantity, channel });
                }
                return res.json({ message: 'Purchase successful' });
            }

            for (const { name, quantity } of items) {
                const item = await inventoryCollection.findOne({ name });
                if (!item) return res.status(404).json({ error: `Product ${name} not found` });
                if (item.stock < quantity) return res.status(400).json({ error: `Not enough stock for ${name}: ${item.stock}` });
                await inventoryCollection.updateOne({ name }, { $inc: { stock: -quantity } });
                await salesCollection.insertOne({ product: name, quantity: parseInt(quantity), date: new Date(), totalPrice: item.price * quantity, channel });
            }
            res.json({ message: 'Purchase successful' });
        } catch (error) {
            console.error('Error processing purchase:', error.message);
            res.status(500).json({ error: 'Purchase failed: ' + error.message });
        }
    });

    function processInMemorySale(req, res) {
        const { name, quantity, channel } = req.body;
        const itemIndex = inMemoryInventory.findIndex(item => item.name === name);
        if (itemIndex === -1) return res.status(404).json({ error: 'Product not found' });
        const item = inMemoryInventory[itemIndex];
        if (item.stock < quantity) return res.status(400).json({ error: `Not enough stock: ${item.stock}` });
        inMemoryInventory[itemIndex].stock -= parseInt(quantity);
        inMemorySales.push({ product: name, quantity: parseInt(quantity), date: new Date(), totalPrice: item.price * quantity, channel });
        return res.json({ message: `Sold ${quantity} ${name}(s)` });
    }

    app.post('/api/inventory/restock', async (req, res) => {
        const { name, quantity } = req.body;
        if (!name || !quantity || quantity <= 0) return res.status(400).json({ error: 'Invalid request data' });

        try {
            if (useInMemoryMode) {
                const itemIndex = inMemoryInventory.findIndex(item => item.name === name);
                if (itemIndex === -1) return res.status(404).json({ error: 'Product not found' });
                inMemoryInventory[itemIndex].stock += parseInt(quantity);
                return res.json({ message: `Restocked ${quantity} ${name}(s)`, newStock: inMemoryInventory[itemIndex].stock });
            }

            if (!await ensureConnection()) return processInMemoryRestock(req, res);
            const item = await inventoryCollection.findOne({ name });
            if (!item) return res.status(404).json({ error: 'Product not found' });
            await inventoryCollection.updateOne({ name }, { $inc: { stock: parseInt(quantity) } });
            const updatedItem = await inventoryCollection.findOne({ name });
            res.json({ message: `Restocked ${quantity} ${name}(s)`, newStock: updatedItem.stock });
        } catch (error) {
            console.error('Error restocking:', error.message);
            useInMemoryMode = true;
            return processInMemoryRestock(req, res);
        }
    });

    function processInMemoryRestock(req, res) {
        const { name, quantity } = req.body;
        const itemIndex = inMemoryInventory.findIndex(item => item.name === name);
        if (itemIndex === -1) return res.status(404).json({ error: 'Product not found' });
        inMemoryInventory[itemIndex].stock += parseInt(quantity);
        return res.json({ message: `Restocked ${quantity} ${name}(s)`, newStock: inMemoryInventory[itemIndex].stock });
    }

    app.get('/api/reports/sales', async (req, res) => {
        try {
            if (useInMemoryMode) return getInMemorySalesReport(res);
            if (!await ensureConnection()) return getInMemorySalesReport(res);
            const salesData = await salesCollection.aggregate([
                { $group: { _id: "$product", quantity: { $sum: "$quantity" }, revenue: { $sum: "$totalPrice" } } },
                { $project: { _id: 0, product: "$_id", quantity: 1, revenue: 1 } }
            ]).toArray();
            const totalRevenue = salesData.reduce((sum, item) => sum + item.revenue, 0);
            res.json({ salesData, totalRevenue });
        } catch (error) {
            console.error('Error generating sales report:', error.message);
            useInMemoryMode = true;
            return getInMemorySalesReport(res);
        }
    });

    function getInMemorySalesReport(res) {
        const salesByProduct = {};
        let totalRevenue = 0;
        inMemorySales.forEach(sale => {
            salesByProduct[sale.product] = salesByProduct[sale.product] || { quantity: 0, revenue: 0 };
            salesByProduct[sale.product].quantity += sale.quantity;
            salesByProduct[sale.product].revenue += sale.totalPrice;
            totalRevenue += sale.totalPrice;
        });
        const salesData = Object.keys(salesByProduct).map(product => ({
            product,
            quantity: salesByProduct[product].quantity,
            revenue: salesByProduct[product].revenue
        }));
        return res.json({ salesData, totalRevenue });
    }

    app.post('/api/auth/login', async (req, res) => {
        const { username, password } = req.body;
        console.log(`Login request received: ${username}`);
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

        try {
            if (useInMemoryMode) {
                if (username === 'admin' && password === 'admin123') return res.json({ success: true, user: { username: 'admin', role: 'admin' } });
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            if (!await ensureConnection()) return processInMemoryLogin(req, res);
            const user = await db.collection('users').findOne({ username });
            if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
            res.json({ success: true, user: { username: user.username, role: user.role } });
        } catch (error) {
            console.error('Login error:', error.message);
            useInMemoryMode = true;
            return processInMemoryLogin(req, res);
        }
    });

    function processInMemoryLogin(req, res) {
        const { username, password } = req.body;
        if (username === 'admin' && password === 'admin123') return res.json({ success: true, user: { username: 'admin', role: 'admin' } });
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    app.post('/api/auth/register', async (req, res) => {
        const { username, password } = req.body;
        console.log(`Register request received: ${username}`);
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

        try {
            if (useInMemoryMode) {
                console.log('Registration failed: In-memory mode active');
                return res.status(503).json({ error: 'Registration unavailable in in-memory mode' });
            }
            if (!await ensureConnection()) {
                console.log('Registration failed: Database unavailable');
                return res.status(503).json({ error: 'Database unavailable' });
            }

            const existingUser = await db.collection('users').findOne({ username });
            if (existingUser) {
                console.log(`Registration failed: Username ${username} already taken`);
                return res.status(400).json({ error: 'Username already taken' });
            }

            await db.collection('users').insertOne({
                username,
                password,
                role: 'user',
                isActive: true
            });
            console.log(`User ${username} registered successfully`);
            res.json({ success: true, message: 'Registration successful. Redirecting to login...' });
        } catch (error) {
            console.error('Registration error:', error.message);
            res.status(500).json({ error: 'Registration failed: ' + error.message });
        }
    });

    const possiblePorts = [5000, 5001, 5002, 5003, 8080];
    let currentPort = 0;

    function startListening() {
        const port = possiblePorts[currentPort];
        const server = app.listen(port)
            .on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    console.log(`Port ${port} busy, trying next...`);
                    server.close();
                    currentPort++;
                    if (currentPort < possiblePorts.length) startListening();
                    else console.error('All ports busy!');
                } else console.error('Server error:', err.message);
            })
            .on('listening', () => console.log(`Server running on http://localhost:${port} (${useInMemoryMode ? 'In-Memory' : 'MongoDB'})`));
    }

    startListening();
}

startServer();