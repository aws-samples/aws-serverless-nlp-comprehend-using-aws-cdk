import os
import json
import uuid
import time
from decimal import Decimal
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

# only for simulation
import random
from datetime import timedelta  

_simulation_date = True
_format_ddmmYYYY_HHMMSS = '%Y/%m/%d %H:%M:%S' # yyyy-mm-dd HH:MM:SS

_table_name = os.environ.get('TABLE_NAME', 'ReviewServiceDev-ReviewBackendStack-ReviewHistoryTable')
_table_partition = os.environ.get('TABLE_PARTITION', 'ProductId')
_table_sort = os.environ.get('TABLE_SORT', 'ReviewId')

_comp = None
_table = None


def get_comprehend():
    global _comp
    if _comp is None:
        _comp = boto3.client('comprehend')
    return _comp


def get_table():
    global _table
    if _table is None:
        resource_ddb = boto3.Session().resource('dynamodb')
        _table = resource_ddb.Table(_table_name)
    return _table


def validate_input(request) -> bool:
    condition_id = True if ('ProductId' in request and len(request['ProductId']) > 0) else False
    condition_review = True if ('Review' in request and len(request['Review']) > 0) else False
    
    if not 'Language' in request:
        request['Language'] = 'en'
    
    return condition_id and condition_review, request


def analyze_sentiment(review: str, language: str) -> dict:
    try:
        response = get_comprehend().detect_sentiment(
                        Text=review,
                        LanguageCode=language
                    )
        del response['ResponseMetadata']
        return response
    except ClientError as e:
        print('[EXCEPT] analyze_sentiment', e)
        raise e


def get_today(rand_date: bool):
    if rand_date:
        alpha = random.randint(0, 15)
        return datetime.now() + timedelta(days=alpha) * (1 if random.randint(0, 1) == 0 else -1)  
    else:
        return datetime.now()


def insert_item(request: dict, sentiment: dict) -> bool :
    today_dt = get_today(_simulation_date)
    timestamp = today_dt.strftime(_format_ddmmYYYY_HHMMSS)
    random_suffix = str(uuid.uuid1()).replace('-', '')
    
    item = {
                _table_partition: request['ProductId'],
                _table_sort: f'{timestamp}-{random_suffix}',
                'Review': request['Review'],
                'Timestamp': time.mktime(today_dt.timetuple()),
                'Sentiment': sentiment
            }
    try:
        get_table().put_item(
                Item=json.loads(json.dumps(item), parse_float=Decimal)
            )
        return True
    except ClientError as e:
        print('[EXCEPT] insert_item', e)
        raise e


def handle(event, context):
    # print('event==>', json.dumps(event, indent=4))
    request = json.loads(event['body'])
    success, request = validate_input(request)
    
    if success:
        sentiment = analyze_sentiment(request['Review'], request['Language'])
        insert_item(request, sentiment)
    
        body_dict = {
            'Status': 'success',
            'Result': sentiment
        }
    else:
        body_dict = {
            'Status': 'fail'
        }

    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps(body_dict)
    }
