import os
import json
from decimal import Decimal
import boto3
from botocore.exceptions import ClientError


_stream_name = os.environ.get('STREAM_NAME', 'ReviewServiceDev-ReviewAnalysisStack-Stream')
_stream_batch_size = int(os.environ.get('STREAM_BATCH_SIZE', '10'))

_comp = None
_kinesis = None


def get_comprehend():
    global _comp
    if _comp is None:
        _comp = boto3.client('comprehend')
    return _comp


def get_kinesis():
    global _kinesis
    if _kinesis is None:
        _kinesis = boto3.client('kinesis')
    return _kinesis


def batch_detect(batch_array: list):
    reviews = [item['Review'] for item in batch_array]
    
    try:
        comp = get_comprehend()
        response_entities = comp.batch_detect_entities(
                    TextList=reviews,
                    LanguageCode='en'
                )
        response_syntax = comp.batch_detect_syntax(
                    TextList=reviews,
                    LanguageCode='en'
                )
        
        records = []
        for index, item in enumerate(reviews):
            batch_array[index]['Entities'] = json.loads(json.dumps(response_entities['ResultList'][index]['Entities']), parse_float=Decimal)
            batch_array[index]['Syntax'] = json.loads(json.dumps(response_syntax['ResultList'][index]['SyntaxTokens']), parse_float=Decimal)
            records.append({
                'Data': json.dumps(batch_array[index], default=str),
                'PartitionKey': batch_array[index]['ProductId']
            })
            
        get_kinesis().put_records(
                StreamName=_stream_name,
                Records=records
            )
    except ClientError as e:
        print('[EXCEPT] batch_detect', e)
        raise e


def process_batch(input_array: list):
    batch_size = _stream_batch_size
    batch_array = []
    last_batch_index = 0
        
    for index, line in enumerate(input_array):
        if len(batch_array) < batch_size:
            batch_array.append(line)
            if len(batch_array) == batch_size:
                batch_detect(batch_array)
                last_batch_index += batch_size
                batch_array.clear()
                
    if len(batch_array) > 0:
        batch_detect(batch_array)
    

def handle(event, context):
    # print('event==>', json.dumps(event, indent=4))
    # print('event==>', len(event['Records']))
    # print('event==>', json.dumps(event['Records'][0], indent=4))
    
    batch_array = []
    for record in event['Records']:
        if record['eventSource'] == 'aws:dynamodb' and record['eventName'] == 'INSERT':
            id = record['dynamodb']['NewImage']['ProductId']['S']
            ts = record['dynamodb']['NewImage']['ReviewId']['S']
            timestamp = record['dynamodb']['NewImage']['Timestamp']['N']
            review = record['dynamodb']['NewImage']['Review']['S']
            
            temp = record['dynamodb']['NewImage']['Sentiment']['M']
            sentiment = {
                'Sentiment': temp['Sentiment']['S'],
                'SentimentScore': {
                    'Neutral': temp['SentimentScore']['M']['Neutral']['N'],
                    'Negative': temp['SentimentScore']['M']['Negative']['N'],
                    'Positive': temp['SentimentScore']['M']['Positive']['N'],
                    'Mixed': temp['SentimentScore']['M']['Mixed']['N']
                }
            }
            
            batch_array.append({
                'ProductId': id,
                'ReviewId': ts,
                'Timestamp': timestamp,
                'Review': review,
                'Sentiment': sentiment
            })
            
    process_batch(batch_array)
