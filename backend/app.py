from flask import Flask, jsonify, request
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime
import os
import json
import requests as http_requests

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# ─── FIREBASE INIT ────────────────────────
firebase_creds = os.environ.get('FIREBASE_CREDENTIALS')
if firebase_creds:
    cred_dict = json.loads(firebase_creds)
    cred = credentials.Certificate(cred_dict)
else:
    cred = credentials.Certificate("serviceAccountKey.json")

firebase_admin.initialize_app(cred)
db = firestore.client()

# ─── SMS CONFIG ───────────────────────────
SEMAPHORE_API_KEY = os.environ.get('SEMAPHORE_API_KEY', 'YOUR_SEMAPHORE_API_KEY')
OWNER_PHONE = os.environ.get('OWNER_PHONE', 'YOUR_PHONE_NUMBER')
# Phone format: 09XXXXXXXXX (Philippine number)

def send_sms(message):
    """Send SMS via Semaphore"""
    try:
        response = http_requests.post(
            'https://api.semaphore.co/api/v4/messages',
            data={
                'apikey': SEMAPHORE_API_KEY,
                'number': OWNER_PHONE,
                'message': message,
                'sendername': 'VoxVend'
            }
        )
        result = response.json()
        print(f"SMS sent: {result}")
        return True
    except Exception as e:
        print(f"SMS error: {e}")
        return False

def check_and_notify_low_stock():
    """Check all snacks and send SMS if any are low stock"""
    try:
        low_stock_items = []
        for doc in db.collection('snacks').stream():
            s = doc.to_dict()
            if s.get('stock', 0) <= s.get('threshold', 10):
                low_stock_items.append(s)

        if low_stock_items:
            message = "⚠️ VoxVend Low Stock Alert!\n\n"
            for item in low_stock_items:
                message += f"• {item['name']}: {item['stock']} left (threshold: {item.get('threshold', 10)})\n"
            message += "\nPlease restock soon!"
            send_sms(message)

        return low_stock_items
    except Exception as e:
        print(f"Low stock check error: {e}")
        return []

# ─── HEALTH CHECK ─────────────────────────
@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'message': 'VoxVend API is running'}), 200

# ─── SNACKS ───────────────────────────────
@app.route('/api/snacks', methods=['GET'])
def get_snacks():
    try:
        snacks = []
        for doc in db.collection('snacks').stream():
            s = doc.to_dict()
            s['id'] = doc.id
            snacks.append(s)
        return jsonify(snacks), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/snacks', methods=['POST'])
def add_snack():
    try:
        data = request.get_json(force=True)
        if not data or not data.get('name'):
            return jsonify({'error': 'Name is required'}), 400

        snack = {
            'name': str(data['name']),
            'category': str(data.get('category', 'general')),
            'price': float(data.get('price', 0)),
            'stock': int(data.get('stock', 0)),
            'threshold': int(data.get('threshold', 10)),
            'total_sold': 0,
            'created_at': datetime.utcnow().isoformat()
        }
        ref = db.collection('snacks').add(snack)

        # Check if new snack is already low stock
        if snack['stock'] <= snack['threshold']:
            send_sms(f"⚠️ VoxVend Alert: New snack '{snack['name']}' added with low stock ({snack['stock']} units)!")

        return jsonify({'id': ref[1].id, 'message': 'Snack added'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/snacks/<snack_id>', methods=['PUT'])
def update_snack(snack_id):
    try:
        data = request.get_json(force=True)
        update = {}
        if 'name' in data: update['name'] = str(data['name'])
        if 'category' in data: update['category'] = str(data['category'])
        if 'price' in data: update['price'] = float(data['price'])
        if 'stock' in data: update['stock'] = int(data['stock'])
        if 'threshold' in data: update['threshold'] = int(data['threshold'])
        db.collection('snacks').document(snack_id).update(update)

        # Check low stock after update
        if 'stock' in data and 'threshold' in data:
            if int(data['stock']) <= int(data['threshold']):
                send_sms(f"⚠️ VoxVend Alert: '{data.get('name', 'A snack')}' is low on stock ({data['stock']} units)!")

        return jsonify({'message': 'Snack updated'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/snacks/<snack_id>', methods=['DELETE'])
def delete_snack(snack_id):
    try:
        db.collection('snacks').document(snack_id).delete()
        return jsonify({'message': 'Snack deleted'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/snacks/<snack_id>/restock', methods=['POST'])
def restock_snack(snack_id):
    try:
        data = request.get_json(force=True)
        quantity = int(data.get('quantity', 0))
        if quantity <= 0:
            return jsonify({'error': 'Quantity must be greater than 0'}), 400

        ref = db.collection('snacks').document(snack_id)
        doc = ref.get()
        if not doc.exists:
            return jsonify({'error': 'Snack not found'}), 404

        snack = doc.to_dict()
        new_stock = snack['stock'] + quantity
        ref.update({'stock': firestore.Increment(quantity)})

        db.collection('restock_logs').add({
            'snack_id': snack_id,
            'snack_name': snack['name'],
            'quantity_added': quantity,
            'previous_stock': snack['stock'],
            'new_stock': new_stock,
            'timestamp': datetime.utcnow().isoformat()
        })

        # Send SMS confirmation
        send_sms(f"✅ VoxVend Restock: '{snack['name']}' restocked by {quantity} units. New stock: {new_stock}")

        return jsonify({
            'message': 'Restocked successfully',
            'new_stock': new_stock
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─── PURCHASE (from vending machine) ──────
@app.route('/api/purchase', methods=['POST'])
def record_purchase():
    try:
        data = request.get_json(force=True)
        snack_id = data.get('snack_id')
        quantity = int(data.get('quantity', 1))

        if not snack_id:
            return jsonify({'error': 'snack_id required'}), 400

        ref = db.collection('snacks').document(snack_id)
        doc = ref.get()
        if not doc.exists:
            return jsonify({'error': 'Snack not found'}), 404

        snack = doc.to_dict()
        if snack['stock'] < quantity:
            return jsonify({'error': 'Insufficient stock'}), 400

        ref.update({
            'stock': firestore.Increment(-quantity),
            'total_sold': firestore.Increment(quantity)
        })

        db.collection('transactions').add({
            'snack_id': snack_id,
            'snack_name': snack['name'],
            'category': snack.get('category', 'general'),
            'quantity': quantity,
            'price': snack['price'],
            'total': snack['price'] * quantity,
            'timestamp': datetime.utcnow().isoformat()
        })

        remaining = snack['stock'] - quantity

        # Send SMS if low stock after purchase
        if remaining <= snack.get('threshold', 10):
            send_sms(
                f"⚠️ VoxVend Low Stock Alert!\n"
                f"'{snack['name']}' only has {remaining} units left.\n"
                f"Please restock soon!"
            )

        return jsonify({
            'message': 'Purchase recorded',
            'remaining_stock': remaining,
            'low_stock': remaining <= snack.get('threshold', 10)
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─── STATISTICS ───────────────────────────
@app.route('/api/stats', methods=['GET'])
def get_stats():
    try:
        snacks = []
        total_revenue = 0
        total_sold = 0
        low_stock = []
        categories = {}

        for doc in db.collection('snacks').stream():
            s = doc.to_dict()
            s['id'] = doc.id
            snacks.append(s)
            sold = s.get('total_sold', 0)
            price = s.get('price', 0)
            total_sold += sold
            total_revenue += sold * price
            cat = s.get('category', 'general')
            categories[cat] = categories.get(cat, 0) + sold
            if s.get('stock', 0) <= s.get('threshold', 10):
                low_stock.append({
                    'id': doc.id,
                    'name': s['name'],
                    'stock': s['stock'],
                    'threshold': s.get('threshold', 10)
                })

        best_sellers = sorted(
            snacks,
            key=lambda x: x.get('total_sold', 0),
            reverse=True
        )[:5]

        return jsonify({
            'total_revenue': total_revenue,
            'total_sold': total_sold,
            'total_products': len(snacks),
            'low_stock_alerts': low_stock,
            'best_sellers': best_sellers,
            'category_breakdown': categories
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/transactions', methods=['GET'])
def get_transactions():
    try:
        limit = int(request.args.get('limit', 20))
        txns = []
        for doc in db.collection('transactions').limit(limit).stream():
            t = doc.to_dict()
            t['id'] = doc.id
            txns.append(t)
        txns.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        return jsonify(txns), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─── DEMOGRAPHICS ─────────────────────────
@app.route('/api/demographics', methods=['GET'])
def get_demographics():
    try:
        txns = []
        for doc in db.collection('transactions').stream():
            txns.append(doc.to_dict())

        category_sales = {}
        hourly_sales = {str(i): 0 for i in range(24)}
        daily_sales = {}
        snack_sales = {}

        for t in txns:
            cat = t.get('category', 'general')
            category_sales[cat] = category_sales.get(cat, 0) + t.get('quantity', 0)

            ts = t.get('timestamp', '')
            if ts:
                try:
                    dt = datetime.fromisoformat(ts)
                    hour = str(dt.hour)
                    hourly_sales[hour] = hourly_sales.get(hour, 0) + t.get('quantity', 0)
                    day = dt.strftime('%A')
                    daily_sales[day] = daily_sales.get(day, 0) + t.get('quantity', 0)
                except:
                    pass

            name = t.get('snack_name', 'Unknown')
            snack_sales[name] = snack_sales.get(name, 0) + t.get('quantity', 0)

        top_snacks = sorted(snack_sales.items(), key=lambda x: x[1], reverse=True)[:5]
        peak_hour = max(hourly_sales, key=hourly_sales.get) if hourly_sales else '0'
        peak_day = max(daily_sales, key=daily_sales.get) if daily_sales else 'N/A'

        return jsonify({
            'category_sales': category_sales,
            'hourly_sales': hourly_sales,
            'daily_sales': daily_sales,
            'top_snacks': [{'name': k, 'sold': v} for k, v in top_snacks],
            'peak_hour': peak_hour,
            'peak_day': peak_day,
            'total_transactions': len(txns)
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─── MANUAL LOW STOCK CHECK + SMS ─────────
@app.route('/api/check-low-stock', methods=['GET'])
def check_low_stock():
    try:
        low_items = check_and_notify_low_stock()
        return jsonify({
            'low_stock_count': len(low_items),
            'items': low_items,
            'sms_sent': len(low_items) > 0
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
